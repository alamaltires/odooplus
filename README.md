# OdooPlus Dashboard

Next.js dashboard that extends Odoo ERP using the Odoo External API, with Firebase Authentication and Firestore-based settings storage.

## Features

- Login page with Firebase email/password auth
- Dashboard page with Odoo order stats
- Settings page to save Odoo credentials per user
- Pending orders listing page
- Single order page with add-product capability

## Tech Stack

- Next.js (App Router, TypeScript)
- Firebase Auth + Firestore
- Odoo JSON-RPC via Next.js API routes
- Tailwind CSS

## Run Locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Firebase Configuration

Firebase is already configured in `src/lib/firebase.ts` using your provided config.

Firestore usage:

- Path: `users/{uid}/integrations/odoo`
- Shape:

```json
{
	"credentials": {
		"url": "https://your-odoo-instance.com",
		"db": "your-db",
		"username": "your-user",
		"password": "your-password"
	},
	"updatedAt": "ISO-8601"
}
```

## Odoo API Endpoints (Internal)

- `POST /api/odoo/dashboard-stats`
- `POST /api/odoo/pending-orders`
- `POST /api/odoo/order`
- `POST /api/odoo/add-line`

These routes call Odoo `/jsonrpc` using `common.authenticate` and `object.execute_kw`.

## Validation

- `npm run lint` passes
- `npm run build` passes
