import { useEffect, useState } from "react";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  AppProvider as PolarisAppProvider,
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  EmptyState,
  IndexTable,
  InlineStack,
  Layout,
  Page,
  Text,
  Thumbnail,
} from "@shopify/polaris";
import enTranslations from "@shopify/polaris/locales/en.json";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import { authenticate } from "../shopify.server";

// Load the Polaris stylesheet via a real <link> tag. This is reliable in both
// dev and production / embedded contexts (a bare CSS side-effect import is not).
export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

/**
 * The exact instruction sent to Gemini. Kept verbatim so the model returns a
 * clean, SEO-friendly string with no surrounding formatting.
 */
const GEMINI_PROMPT =
  "Write a concise, SEO-optimized alt-text description for this e-commerce product image. Focus on the product name, color, and material. Keep it under 125 characters. Return ONLY the text, no quotes or formatting.";

/** Shopify/accessibility best practice: keep alt text short. */
const MAX_ALT_LENGTH = 125;

/* -------------------------------------------------------------------------- */
/*  Server helpers (only ever executed inside the loader/action)              */
/* -------------------------------------------------------------------------- */

/**
 * Gemini occasionally wraps its answer in quotes/backticks or adds line
 * breaks. Normalise the response and hard-cap the length at a word boundary.
 */
function sanitizeAltText(raw) {
  if (!raw) return "";

  let text = String(raw)
    .replace(/\s+/g, " ") // collapse newlines / double spaces
    .replace(/^["'`\s]+|["'`\s]+$/g, "") // strip wrapping quotes/backticks
    .trim();

  if (text.length > MAX_ALT_LENGTH) {
    const truncated = text.slice(0, MAX_ALT_LENGTH);
    const lastSpace = truncated.lastIndexOf(" ");
    text = (lastSpace > 80 ? truncated.slice(0, lastSpace) : truncated).trim();
  }

  return text;
}

/**
 * Download a (public) Shopify CDN image and return it as base64 inline data.
 * We inline the bytes rather than handing Gemini a `fileUri` so we never depend
 * on Gemini being able to reach the CDN, and so signed/expiring URLs still work.
 * The real Content-Type is used so PNG/WEBP/JPEG images are all handled.
 */
async function fetchImageAsInlineData(imageUrl) {
  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(
      `Failed to download the product image (HTTP ${response.status}).`,
    );
  }

  const contentType = response.headers.get("content-type") || "image/jpeg";
  const mimeType = contentType.split(";")[0].trim() || "image/jpeg";
  const arrayBuffer = await response.arrayBuffer();
  // eslint-disable-next-line no-undef
  const data = Buffer.from(arrayBuffer).toString("base64");

  return { mimeType, data };
}

/* -------------------------------------------------------------------------- */
/*  Loader: billing gate + scan the store for images missing alt text          */
/* -------------------------------------------------------------------------- */

export const loader = async ({ request }) => {
  const { admin, billing } = await authenticate.admin(request);

  // Shopify billing is unavailable on custom-distribution apps ("Custom apps
  // cannot use the Billing API"). This dev-only flag skips the paywall so you
  // can keep building locally. Remove it once the app uses Public distribution.
  // eslint-disable-next-line no-undef
  const billingBypass = process.env.BILLING_BYPASS === "true";

  // Billing gate. `check` is non-throwing, so we can render a custom paywall
  // instead of forcing an immediate redirect to Shopify's charge page.
  let hasActivePayment = billingBypass;
  if (!billingBypass) {
    // Managed Pricing: reads the merchant's hosted subscription (any active
    // plan unlocks the app). Works in test mode on dev stores automatically.
    const check = await billing.check();
    hasActivePayment = check.hasActivePayment;
  }

  if (!hasActivePayment) {
    return { hasActiveSubscription: false, products: [], scannedCount: 0 };
  }

  // ---- Existing product-scan logic (unchanged, only gated by billing) ----
  // Fetch a window of recent products with their media. We over-fetch (20) so
  // we can keep the first 10 that actually have an image attached.
  const response = await admin.graphql(
    `#graphql
    query AltGeniusScanProducts {
      products(first: 20, sortKey: UPDATED_AT, reverse: true) {
        nodes {
          id
          title
          status
          media(first: 5) {
            nodes {
              ... on MediaImage {
                id
                alt
                image {
                  url
                }
              }
            }
          }
        }
      }
    }`,
  );

  const responseJson = await response.json();
  const productNodes = responseJson?.data?.products?.nodes ?? [];

  const productsWithImages = [];
  for (const node of productNodes) {
    // The media connection can contain videos / 3D models, so find the first
    // node that is actually an image with a usable URL.
    const mediaImage = (node.media?.nodes ?? []).find(
      (media) => media && media.id && media.image?.url,
    );
    if (!mediaImage) continue;

    const alt = (mediaImage.alt ?? "").trim();

    productsWithImages.push({
      id: node.id,
      title: node.title,
      status: node.status,
      image: {
        id: mediaImage.id, // gid://shopify/MediaImage/... — needed by fileUpdate
        url: mediaImage.image.url,
        alt,
      },
      needsAltText: alt.length === 0,
    });

    if (productsWithImages.length >= 10) break; // first 10 products with images
  }

  // Only surface the products that actually need work.
  const products = productsWithImages.filter((product) => product.needsAltText);

  return {
    hasActiveSubscription: true,
    billingBypassed: billingBypass,
    products,
    scannedCount: productsWithImages.length,
  };
};

// Keep just-generated rows visible: don't auto-revalidate the loader after the
// "Generate Alt Text" fetcher (POST) — that would re-filter the list and drop
// the product you just fixed before you can see the result. The "Rescan
// products" button (an explicit revalidation with no form) still refreshes.
export function shouldRevalidate({ formMethod, defaultShouldRevalidate }) {
  if (formMethod === "POST") return false;
  return defaultShouldRevalidate;
}

/* -------------------------------------------------------------------------- */
/*  Action: generate alt text with Gemini, then persist it on Shopify          */
/*  (Unchanged — this is the working backend logic.)                           */
/* -------------------------------------------------------------------------- */

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  const formData = await request.formData();
  const productId = formData.get("productId");
  const imageId = formData.get("imageId");

  if (!imageId) {
    return {
      success: false,
      error: "Missing image id.",
      productId,
      imageId,
    };
  }

  // Read the API key from the environment — never hardcoded.
  // eslint-disable-next-line no-undef
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      success: false,
      error:
        "GEMINI_API_KEY is not configured on the server. Add it to your .env file and restart the dev server.",
      productId,
      imageId,
    };
  }

  try {
    // 1) Resolve the current image URL for this MediaImage straight from Shopify.
    const mediaResponse = await admin.graphql(
      `#graphql
      query AltGeniusGetMediaImage($id: ID!) {
        node(id: $id) {
          ... on MediaImage {
            id
            image {
              url
            }
          }
        }
      }`,
      { variables: { id: imageId } },
    );
    const mediaJson = await mediaResponse.json();
    const imageUrl = mediaJson?.data?.node?.image?.url;

    if (!imageUrl) {
      return {
        success: false,
        error: "Could not resolve the image URL from Shopify.",
        productId,
        imageId,
      };
    }

    // 2) Pull the image down and inline it as base64 for Gemini Vision.
    const inlineImage = await fetchImageAsInlineData(imageUrl);

    // 3) Ask Gemini to write the alt text.
    // gemini-1.5-flash was retired in Sept 2025, so we default to a current
    // vision-capable Flash model. Override with GEMINI_MODEL if you need to.
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      // eslint-disable-next-line no-undef
      model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
    });

    const result = await model.generateContent([
      GEMINI_PROMPT,
      { inlineData: inlineImage },
    ]);

    const altText = sanitizeAltText(result.response.text());
    if (!altText) {
      return {
        success: false,
        error: "Gemini returned an empty description. Please try again.",
        productId,
        imageId,
      };
    }

    // 4) Persist the alt text on the Shopify MediaImage.
    // NOTE: productImageUpdate was removed in recent API versions. Product
    // images are MediaImage files, so we update them with fileUpdate.
    const updateResponse = await admin.graphql(
      `#graphql
      mutation AltGeniusFileUpdate($files: [FileUpdateInput!]!) {
        fileUpdate(files: $files) {
          files {
            alt
            ... on MediaImage {
              id
              image {
                url
              }
            }
          }
          userErrors {
            field
            message
            code
          }
        }
      }`,
      { variables: { files: [{ id: imageId, alt: altText }] } },
    );

    const updateJson = await updateResponse.json();
    const userErrors = updateJson?.data?.fileUpdate?.userErrors ?? [];

    if (userErrors.length > 0) {
      return {
        success: false,
        error: userErrors.map((err) => err.message).join(" "),
        productId,
        imageId,
      };
    }

    return {
      success: true,
      altText,
      productId,
      imageId,
    };
  } catch (error) {
    return {
      success: false,
      error:
        error?.message || "Unexpected error while generating the alt text.",
      productId,
      imageId,
    };
  }
};

/* -------------------------------------------------------------------------- */
/*  UI                                                                         */
/* -------------------------------------------------------------------------- */

const FEATURES = [
  "One-click AI alt-text generation",
  "Boost Google Image Search ranking",
  "Accessibility (WCAG) compliance",
];

const EMPTY_STATE_IMAGE =
  "https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png";

/** Small green circular check used in the marketing feature list. */
function CheckMark() {
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 22,
        height: 22,
        borderRadius: "50%",
        flexShrink: 0,
        backgroundColor: "var(--p-color-bg-fill-success)",
        color: "var(--p-color-text-inverse)",
        fontSize: 13,
        fontWeight: 700,
        lineHeight: 1,
      }}
    >
      ✓
    </span>
  );
}

/* ------------------------------- Paywall ---------------------------------- */

function Paywall() {
  const [isStarting, setIsStarting] = useState(false);

  // Full-page navigation (NOT a fetcher) to /app/subscribe. This lets the
  // billing redirect use Shopify's reliable exit-iframe break-out instead of
  // the XHR path that gets stuck on the "Handling response" page. We keep the
  // embedded params (host, embedded=1) so the server knows to escape the iframe.
  const startSubscription = () => {
    setIsStarting(true);
    const params = new URLSearchParams(window.location.search);
    params.set("embedded", "1");
    window.location.href = `/app/subscribe?${params.toString()}`;
  };

  return (
    <Page>
      <Box paddingBlockStart="800" paddingBlockEnd="400">
        <Layout>
          <Layout.Section variant="oneHalf">
            <Box paddingBlockStart="400" paddingInlineEnd="400">
              <BlockStack gap="500">
                <BlockStack gap="300">
                  <Text as="h1" variant="heading3xl" fontWeight="bold">
                    AltGenius AI
                  </Text>
                  <Text as="p" variant="bodyLg" tone="subdued">
                    Automatically generate perfect SEO alt-text for your product
                    images using Google Gemini Vision.
                  </Text>
                </BlockStack>

                <BlockStack gap="300">
                  {FEATURES.map((feature) => (
                    <InlineStack
                      key={feature}
                      gap="300"
                      blockAlign="center"
                      wrap={false}
                    >
                      <CheckMark />
                      <Text as="span" variant="bodyMd" fontWeight="medium">
                        {feature}
                      </Text>
                    </InlineStack>
                  ))}
                </BlockStack>
              </BlockStack>
            </Box>
          </Layout.Section>

          <Layout.Section variant="oneHalf">
            <Card>
              <Box padding="400">
                <BlockStack gap="500" inlineAlign="center">
                  <Badge tone="success">Pro plan</Badge>

                  <InlineStack gap="100" blockAlign="baseline">
                    <Text as="span" variant="heading3xl" fontWeight="bold">
                      $4.99
                    </Text>
                    <Text as="span" variant="headingMd" tone="subdued">
                      /month
                    </Text>
                  </InlineStack>

                  <Badge tone="info">14-day free trial</Badge>

                  <Text as="p" variant="bodyMd" tone="subdued" alignment="center">
                    Unlimited AI alt-text generation for your entire catalog.
                  </Text>

                  <Box width="100%" paddingBlockStart="200">
                    <Button
                      variant="primary"
                      size="large"
                      fullWidth
                      loading={isStarting}
                      onClick={startSubscription}
                    >
                      Start Subscription
                    </Button>
                  </Box>

                  <Text as="span" variant="bodySm" tone="subdued">
                    Free for 14 days, then $4.99/month. Cancel anytime — billed
                    securely through Shopify.
                  </Text>
                </BlockStack>
              </Box>
            </Card>
          </Layout.Section>
        </Layout>
      </Box>
    </Page>
  );
}

/* ------------------------------ Dashboard --------------------------------- */

function Dashboard() {
  const { products, scannedCount, billingBypassed } = useLoaderData();
  const fetcher = useFetcher();
  const revalidator = useRevalidator();
  const shopify = useAppBridge();

  // Client-side record of freshly generated alt text, keyed by MediaImage id.
  const [generated, setGenerated] = useState({});
  const [errorMessage, setErrorMessage] = useState("");

  const isSubmitting =
    fetcher.state !== "idle" && fetcher.formMethod === "POST";
  const submittingImageId = isSubmitting
    ? fetcher.formData?.get("imageId")
    : null;

  // React to the action result: toast on success, banner on failure.
  useEffect(() => {
    if (!fetcher.data) return;

    if (fetcher.data.success) {
      setGenerated((prev) => ({
        ...prev,
        [fetcher.data.imageId]: fetcher.data.altText,
      }));
      setErrorMessage("");
      shopify.toast.show("Alt text generated!");
    } else if (fetcher.data.error) {
      setErrorMessage(fetcher.data.error);
    }
  }, [fetcher.data, shopify]);

  const generateAltText = (product) => {
    setErrorMessage("");
    fetcher.submit(
      { productId: product.id, imageId: product.image.id },
      { method: "POST" },
    );
  };

  const resourceName = { singular: "product", plural: "products" };

  return (
    <Page
      title="AltGenius Dashboard"
      subtitle="Images missing SEO alt-text"
      primaryAction={{
        content: "Rescan products",
        onAction: () => revalidator.revalidate(),
        loading: revalidator.state === "loading",
      }}
    >
      <Layout>
        {billingBypassed && (
          <Layout.Section>
            <Banner tone="info" title="Billing bypassed (development)">
              <p>
                <code>BILLING_BYPASS</code> is enabled in .env, so the
                subscription paywall is skipped. Turn it off once your app uses
                Public distribution and real billing works.
              </p>
            </Banner>
          </Layout.Section>
        )}

        {errorMessage && (
          <Layout.Section>
            <Banner
              tone="critical"
              title="Couldn't generate alt text"
              onDismiss={() => setErrorMessage("")}
            >
              <p>{errorMessage}</p>
            </Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          <Card padding="0">
            {products.length === 0 ? (
              <EmptyState heading="You're all caught up!" image={EMPTY_STATE_IMAGE}>
                <p>All your product images have optimized alt text.</p>
              </EmptyState>
            ) : (
              <IndexTable
                resourceName={resourceName}
                itemCount={products.length}
                selectable={false}
                headings={[
                  { title: "Image" },
                  { title: "Product" },
                  { title: "Status" },
                  { title: "" },
                ]}
              >
                {products.map((product, index) => {
                  const newAlt = generated[product.image.id];
                  const rowLoading = submittingImageId === product.image.id;

                  return (
                    <IndexTable.Row
                      id={product.image.id}
                      key={product.image.id}
                      position={index}
                    >
                      <IndexTable.Cell>
                        <Thumbnail
                          source={product.image.url}
                          alt={product.title}
                          size="small"
                        />
                      </IndexTable.Cell>

                      <IndexTable.Cell>
                        <BlockStack gap="100">
                          <Text as="span" variant="bodyMd" fontWeight="semibold">
                            {product.title}
                          </Text>
                          {newAlt && (
                            <Text as="span" variant="bodySm" tone="subdued">
                              {newAlt}
                            </Text>
                          )}
                        </BlockStack>
                      </IndexTable.Cell>

                      <IndexTable.Cell>
                        {newAlt ? (
                          <Badge tone="success">Updated</Badge>
                        ) : (
                          <Badge tone="attention">Missing</Badge>
                        )}
                      </IndexTable.Cell>

                      <IndexTable.Cell>
                        <InlineStack align="end">
                          <Button
                            variant="primary"
                            loading={rowLoading}
                            disabled={Boolean(newAlt)}
                            onClick={() => generateAltText(product)}
                          >
                            {newAlt ? "Done" : "Generate Alt Text"}
                          </Button>
                        </InlineStack>
                      </IndexTable.Cell>
                    </IndexTable.Row>
                  );
                })}
              </IndexTable>
            )}
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Box paddingBlockEnd="400">
            <Text as="p" variant="bodySm" tone="subdued" alignment="center">
              Scanned {scannedCount} product images.
            </Text>
          </Box>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

/* -------------------------------- Root ------------------------------------ */

export default function Index() {
  const { hasActiveSubscription } = useLoaderData();

  return (
    <PolarisAppProvider i18n={enTranslations}>
      {hasActiveSubscription ? <Dashboard /> : <Paywall />}
    </PolarisAppProvider>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
