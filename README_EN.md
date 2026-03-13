# Cookie King (English)

Cookie King helps you move an already-authenticated website session from one authorized browser/device to another, so you can avoid repeated login and verification steps.

[![Chrome Web Store](https://img.shields.io/badge/Chrome%20Web%20Store-Under%20Review-1a73e8?logo=googlechrome&logoColor=white)](#get-it)
[![Deploy Backend](https://img.shields.io/badge/Backend-Cloudflare%20Worker-f38020?logo=cloudflare&logoColor=white)](worker/README.md)
[![Privacy Policy](https://img.shields.io/badge/Privacy-Policy-2e7d32)](docs/chrome-store/privacy-policy-cn.md)

> Use only on accounts and devices you are authorized to access.

## What It Solves

- Moving to a new laptop or backup browser without re-logging into every site.
- Reducing repeated QR/SMS/2FA prompts for day-to-day operational workflows.
- Restoring a ready-to-use website environment across authorized devices.

## Why It Works

- Faster setup: migrate usable session state instead of repeating login flow.
- More reliable restore: synchronizes both Cookie and site storage snapshots.
- Self-hosted backend: encrypted ciphertext is stored on your own Worker backend.

## How It Works

1. Capture site Cookie and Storage from an authenticated page.
2. Encrypt snapshot locally in the browser.
3. Upload encrypted snapshot to your Worker backend.
4. Pull snapshot with a share code on another authorized device and restore.

The backend stores ciphertext, not plaintext cookie values.

## Get It

The Chrome Web Store listing is currently under review. The official store URL will be added after approval.

## Backend Deployment

Choose one path:

### Option A: Cloudflare Dashboard

1. Create a Worker.
2. Paste `worker/src/index.js` into the online editor.
3. Create a KV namespace.
4. Add Worker binding:
   - Variable name: `COOKIE_STORE`
   - Namespace: your KV namespace
5. Deploy and verify `https://<your-worker>.<subdomain>.workers.dev/api/health`.

### Option B: Local CLI

```bash
cd worker
npm install
npx wrangler login
# set your KV namespace id in worker/wrangler.toml
npm test
npm run deploy
```

Full backend guide: [worker/README.md](worker/README.md).

## API

Only `V3` is publicly supported:

- `GET /api/health`
- `POST /api/v3/owners/bootstrap`
- `POST /api/v3/channels`
- `GET /api/v3/owners/sites`
- `DELETE /api/v3/owners/sites`
- `GET | PUT | DELETE /api/v3/channels/:channelId/sites/:siteId`
- `DELETE /api/v3/channels/:channelId`

## Compatibility

- Extension `0.1.x` -> Worker API `V3`

## Security Notes

- Snapshots are encrypted client-side before upload.
- Pull requires `read token`.
- Push/delete requires owner credentials and `write token`.
- Deleting backend records does not force instant logout on target sites; site session policy still applies.
