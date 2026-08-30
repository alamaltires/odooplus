---
name: deploy-and-webhook
description: How OdooPlus deploys, and the inventory webhook's dependency on Odoo sending qty_available
metadata:
  type: project
---

**Deploy:** OdooPlus deploys by committing/pushing to `origin/main` (https://github.com/adeebaboud/odooplus.git). No feature-branch workflow — commits land on `main`. An external tool sometimes auto-commits (e.g. a commit titled "begin with claude" appeared mid-session). Host serves behind Apache.

**Inventory webhook** (`/api/odoo/inventory-webhook/[token]`, handler at `src/app/api/odoo/inventory-webhook/handler.ts`): only defines POST for the real work, so a browser GET returns 405 (expected, not a bug — GET/HEAD now return a 200 health check showing recent events).

The handler **requires `qty_available` in the POST body**. The whole chain (page auto-update, qty update, status→ready, desktop notification, email to sales@dme-medical.com) cascades from the Firestore write in `applyInventoryWebhookToBackorders` — the notification + email themselves are sent **client-side** by the pending-orders page when it sees a status flip to `ready`, so they only fire when someone has that page open.

**Odoo credentials:** there are NO `ODOO_*` env vars in production (`.env.local` has only Firebase/SMTP/WEBHOOK_TOKEN). Real Odoo creds live in **Firestore** at `users/{uid}/integrations/odoo.credentials`. Session routes read them via `getOdooCredentialsFromRequest`; session-less system tasks use `getStoredOdooCredentials()` (auth-helpers) which scans the `integrations` collectionGroup. The env-based orders webhook `[token]/orders/[id]/route.ts` (`getWebhookCredentialsFromEnv`) effectively never worked since those env vars are unset.

**June 2026 bug + fix (RESOLVED):** Odoo's inventory webhook fires on `product.template` and sends the **template id**, but legacy backorders stored the **variant id** in `product_id` (created before canonicalization; `product_variant_id` was null), so `matchedBackorders` was always 0 → nothing updated. Fixed by: (1) a one-time migration `POST /api/backorders/migrate-template-ids?token=<WEBHOOK_TOKEN>` (`migrateBackordersToTemplateIds`) that rewrote 106/112 backorders to store template ids using stored Firestore creds + `mapProductIdsToTemplateAndVariant` (search_read, never throws on a template id — unlike `resolveCanonicalProductIds`/`getTemplateIdsByVariantIds` which use `read` and MissingError-throw on template ids); (2) the webhook now resolves the incoming id to all equivalent ids and falls back to stored Firestore creds. New backorders via `/api/backorders` canonicalize correctly (store template id).

A diagnostics recorder (`recordInventoryWebhookEvent` / `getRecentInventoryWebhookEvents` in `src/lib/server/backorders-store.ts`) logs the last 20 webhook hits to Firestore `webhook-debug/inventory`; open the webhook URL in a browser (GET, with the token) to inspect them. `applyInventoryWebhookToBackorders` also returns a `debug` block on zero-match.
