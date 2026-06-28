# AltGenius AI

A Shopify app that scans a store's product images for **missing/empty alt text**, uses **Google Gemini Vision** to write a concise, SEO-optimized description, and saves it back to Shopify. Built on the Shopify **React Router** template with **Polaris React** UI and the **Billing API** (subscription with a free trial).

---

## How it works

1. **Loader** ([app/routes/app._index.jsx](app/routes/app._index.jsx)) — gates the app behind an active subscription (`billing.check`), then queries the first products that have images and keeps the ones whose primary image alt text is empty.
2. **Action** (same file) — for a given product image: fetches the image, sends it to Gemini Vision as base64 inline data, sanitizes the result to ≤125 chars, and writes it back with the `fileUpdate` mutation (product images are `MediaImage` files; `productImageUpdate` was removed in current API versions).
3. **UI** — a Polaris paywall (for non-subscribers) and a dashboard `IndexTable` with per-row **Generate Alt Text** buttons, toast on success, and an empty state.

### Key files
| File | Purpose |
| --- | --- |
| [app/routes/app._index.jsx](app/routes/app._index.jsx) | Loader, action (Gemini + `fileUpdate`), paywall + dashboard UI |
| [app/routes/app.subscribe.jsx](app/routes/app.subscribe.jsx) | Starts the Billing API subscription (full-page nav → exit-iframe redirect) |
| [app/shopify.server.js](app/shopify.server.js) | App config + billing plan (`MONTHLY_PLAN`, $15/mo, 14-day trial) |
| `shopify.app.altgenius.toml` | The active app config (handle `altgenius`, access scopes) |

---

## Setup

### Prerequisites
- Node `>=20.19 <22 || >=22.12`
- [Shopify CLI](https://shopify.dev/docs/apps/tools/cli/getting-started) + a Shopify Partner account and dev store
- A Google Gemini API key — https://aistudio.google.com/app/apikey

### Environment variables (`.env`, gitignored)
```ini
GEMINI_API_KEY=your-google-ai-studio-key      # required (keys start with "AIza...")
GEMINI_MODEL=gemini-2.5-flash                 # optional; any current vision model
BILLING_BYPASS=false                          # dev-only; see "Billing" below
```
> `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET` etc. are injected automatically by `shopify app dev`.

### Install & run
```shell
npm install
npm run dev      # press "p" to open, then Install on your dev store
```

Access scopes (`read_products,write_products,write_files`) live in `shopify.app.altgenius.toml`. After changing them, run `npm run deploy` and re-approve the app.

---

## Billing

- **Plan:** `$15/month` with a **14-day free trial**, defined in code in [app/shopify.server.js](app/shopify.server.js) (`trialDays: 14`). Change the price/trial there.
- **Public distribution is required.** Shopify only lets **Public (App Store)** apps charge merchants — *"Custom apps cannot use the Billing API."* This app is set to Public distribution in the Partner Dashboard.
- **Flow:** paywall → **Start Subscription** → full-page navigation to `/app/subscribe` → `billing.request` → Shopify's hosted charge page → approve → back to the dashboard (`billing.check` now passes).

### `BILLING_BYPASS` (development only)
Set `BILLING_BYPASS=true` in `.env` to skip the paywall while developing (e.g. testing on a custom/non-billable app). The dashboard shows a "Billing bypassed" banner when active. **Keep it `false` in production.**

---

## Going live (App Store)

Optional — only needed to be publicly discoverable:
1. Host the app in production (Fly.io / Render / Google Cloud Run) and set `NODE_ENV=production`. Swap the SQLite Prisma session store for a hosted DB if running multiple instances.
2. `npm run deploy` to push config.
3. Partner Dashboard → app → **Distribution** → complete the **App Store listing** (icon, screenshots, description, **privacy policy**) and submit for review.

---

## Notes / gotchas
- **One config file:** `shopify.app.altgenius.toml` is the live config (app handle `altgenius`). The old default `shopify.app.toml` was removed. If the CLI ever can't find the app, run `npm run config:link` and pick the `altgenius` app.
- **Polaris React CSS** is loaded via a `links` export in [app/routes/app._index.jsx](app/routes/app._index.jsx) (a bare CSS `import` isn't reliable in the embedded dev server).
- Never commit `.env` — it's gitignored.
