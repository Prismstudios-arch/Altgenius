import { authenticate } from "../shopify.server";
import db from "../db.server";

/**
 * Mandatory privacy/compliance webhooks required for Shopify App Store apps:
 *   - customers/data_request  (provide stored customer data)
 *   - customers/redact        (delete a customer's data)
 *   - shop/redact             (delete a shop's data, ~48h after uninstall)
 *
 * `authenticate.webhook` verifies the HMAC and returns 401 automatically on an
 * invalid signature, satisfying Shopify's requirement; a valid request returns
 * 200. AltGenius stores no customer personal data (only Shopify session records
 * keyed by shop), so the customer topics need no action. On shop/redact we clear
 * any remaining data we hold for that shop.
 */
export const action = async ({ request }) => {
  const { topic, shop } = await authenticate.webhook(request);

  console.log(`Received ${topic} compliance webhook for ${shop}`);

  if (topic === "SHOP_REDACT" && shop) {
    await db.session.deleteMany({ where: { shop } });
  }

  return new Response();
};
