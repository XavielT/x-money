# X Money 💰

Personal money manager. **100% local** — no backend, no account, no bank sync.
Your data never leaves your device. Installable on your phone as a PWA and works fully offline.

Built with Angular (standalone components + Signals), SCSS, and localStorage. See [PLAN.md](PLAN.md) for the research and architecture.

## Features

- ➕ Fast expense/income entry with categories, accounts, date and notes
- 📆 Transaction history grouped by day, navigable by month
- 🏠 Dashboard: total balance, monthly income vs expenses, top spending, recent movements
- 📊 Stats: category donut chart per month (expenses or income)
- 🎯 Monthly budgets per category with progress bars and over-budget warnings
- 👛 Multiple accounts (Cash, Card, custom) with initial balances
- 💱 Currency symbol setting ($, RD$, €, £, ¥)
- 💾 JSON backup export/import · wipe data

## Development

```bash
npm install
npm start        # dev server on http://localhost:4200
npm run build    # production build → dist/x-money/browser
```

## Install on your phone

The production build is static files; the service worker makes it installable and offline-capable.

**Option A — free static hosting (recommended):**
Deploy `dist/x-money/browser` to GitHub Pages, Netlify or Vercel, open the URL on your phone,
then browser menu → **Add to Home Screen / Install app**. Data still stays on the device.

**Option B — same Wi-Fi:**

```bash
npm run build
npx http-server dist/x-money/browser -p 8080
```

Open `http://<your-pc-ip>:8080` on the phone and add it to the home screen.
Note: the service worker (full offline mode) requires HTTPS or localhost, so prefer Option A
for a true installed-app experience.

## Data & backups

Everything is stored in `localStorage` under `x-money:*` keys.
Use **Settings → Export backup** before changing phone or clearing browser data,
and **Import backup** to restore.
