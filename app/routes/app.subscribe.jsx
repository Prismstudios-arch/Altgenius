import { authenticate, APP_HANDLE } from "../shopify.server";

/**
 * Sends the merchant to Shopify's hosted Managed Pricing plan-selection page.
 *
 * Managed Pricing apps can't create charges via the Billing API, so the paywall
 * button navigates here and we redirect (top-level, out of the iframe) to:
 *   https://admin.shopify.com/store/<store>/charges/<APP_HANDLE>/pricing_plans
 *
 * The `redirect` helper from `authenticate.admin` expands the `shopify://admin`
 * shorthand to that URL (filling in the current store) and, with target "_top",
 * breaks out of the embedded iframe. After the merchant picks a plan, Shopify
 * returns them to the app.
 */
export const loader = async ({ request }) => {
  const { redirect } = await authenticate.admin(request);

  return redirect(`shopify://admin/charges/${APP_HANDLE}/pricing_plans`, {
    target: "_top",
  });
};
