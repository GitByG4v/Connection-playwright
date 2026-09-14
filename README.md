# connection-playwright

A tiny service that opens Connection.com's SKU search in a real headless
browser (Playwright + Chromium), follows the redirect, and returns the
final product URL if one exists.

## Endpoints

- `GET /health` → `{ "status": "ok" }`
- `POST /lookup` with body `{ "sku": "5137" }` → returns the resolved
  product URL, or `success: false` if no product page was found.

## 1. Push to GitHub

From inside this folder:

```bash
git init
git add .
git commit -m "Initial commit: connection-playwright lookup service"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/connection-playwright.git
git push -u origin main
```

Replace `YOUR_USERNAME` with your GitHub username. If the repo doesn't
exist yet, create an empty one first at https://github.com/new (don't
initialize it with a README, or `git push` will complain about
diverging histories — if that happens, run `git pull origin main --allow-unrelated-histories` first).

## 2. Deploy on Render

1. Go to https://dashboard.render.com
2. Click **New → Web Service**
3. Connect the `connection-playwright` GitHub repo
4. Configure:
   - **Name:** `connection-playwright`
   - **Runtime:** Docker
   - **Branch:** `main`
   - **Instance type:** Free
5. Click **Create Web Service** and wait for the status to say **Live**

Render will give you a URL like:

```
https://connection-playwright-xxxx.onrender.com
```

## 3. Test it

```bash
curl https://connection-playwright-xxxx.onrender.com/health

curl -X POST https://connection-playwright-xxxx.onrender.com/lookup \
  -H "Content-Type: application/json" \
  -d '{"sku":"5137"}'
```

Expected `/lookup` response shape:

```json
{
  "success": true,
  "sku": "5137",
  "finalUrl": "https://www.connection.com/product/.../5137/...",
  "url": "https://www.connection.com/product/.../5137/...",
  "isProductPage": true,
  "skuMatch": true
}
```

## 4. Test locally (optional, before deploying)

```bash
npm install
npx playwright install --with-deps chromium
npm start
```

Then hit `http://localhost:3000/health` and `http://localhost:3000/lookup`
the same way as above.

## Notes

- Render's free tier spins the service down after 15 minutes of
  inactivity; the first request after that can take ~30-60s to wake it
  back up. Plan your n8n batching accordingly (don't fire all SKUs at
  once — loop with a short delay).
- Never commit API keys, Supabase credentials, or cookies to this repo.
- This service only opens the same public search URL a normal browser
  would use — it doesn't attempt to bypass any bot protection. If
  Connection.com ever blocks it, switch to an official/approved data
  source rather than adding stealth/proxy workarounds.
