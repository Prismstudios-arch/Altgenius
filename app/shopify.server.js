import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";

/**
 * The app's handle (the segment in admin.shopify.com/store/<store>/apps/<HANDLE>).
 * Used to build the Managed Pricing plan-selection URL. Override with the
 * SHOPIFY_APP_HANDLE env var if your handle differs.
 */
export const APP_HANDLE = process.env.SHOPIFY_APP_HANDLE || "altgenius-4";

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.October25,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  // Managed Pricing: the plan, $4.99 price, and 14-day trial are configured in
  // the Partner Dashboard, NOT in code. We don't call billing.request(); this
  // flag lets billing.check() read the merchant's managed-pricing subscription.
  future: {
    expiringOfflineAccessTokens: true,
    unstable_managedPricingSupport: true,
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.October25;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
