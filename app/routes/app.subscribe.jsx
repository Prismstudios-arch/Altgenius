import { redirect } from "react-router";
import { authenticate, MONTHLY_PLAN } from "../shopify.server";

/**
 * Starts the Shopify Billing API subscription flow.
 *
 * The paywall's "Start Subscription" button does a full-page navigation here
 * (carrying the embedded `host`/`embedded=1` params). `billing.request` creates
 * the charge and throws a redirect that breaks out of the embedded iframe to
 * Shopify's hosted charge-confirmation page via the exit-iframe flow. After the
 * merchant approves, Shopify returns them to AltGenius. The 14-day trial is
 * defined on the plan in shopify.server.js.
 */
export const loader = async ({ request }) => {
  const { billing } = await authenticate.admin(request);

  // isTest keeps the charge from hitting a real card while developing.
  // eslint-disable-next-line no-undef
  const isTest = process.env.NODE_ENV !== "production";

  try {
    await billing.request({ plan: MONTHLY_PLAN, isTest });
  } catch (error) {
    // Success: billing.request ALWAYS throws a redirect Response — let it
    // through so the iframe breaks out to Shopify's charge page.
    if (error instanceof Response) {
      throw error;
    }

    // Failure (e.g. a BillingError): log it and send the merchant back to the
    // app, preserving the embedded params so it loads correctly.
    // eslint-disable-next-line no-undef
    console.error(
      "AltGenius billing request failed:",
      error?.message,
      error?.errorData,
    );
    const url = new URL(request.url);
    throw redirect(`/app${url.search}`);
  }

  // Unreachable: billing.request always throws on success.
  return null;
};
