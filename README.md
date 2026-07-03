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

## Install on your phone (Android APK)

The app ships as a native Android app via [Capacitor](https://capacitorjs.com). To build the APK:

```bash
npm run build                # rebuild web assets
npx cap sync android         # copy them into the native project
cd android
gradlew.bat assembleDebug    # needs Android SDK (Android Studio) + JDK 17+
```

The APK lands in `android/app/build/outputs/apk/debug/app-debug.apk`.
Copy it to your phone (USB, Drive, WhatsApp-to-yourself...), open it, and allow
"install from unknown sources" when Android asks. That's it — X Money appears as
a normal app, fully offline.

> If `JAVA_HOME` is not set, point it at Android Studio's bundled JDK:
> `C:\Program Files\Android\Android Studio\jbr`

**Alternative (no APK):** deploy `dist/x-money/browser` to any static host (GitHub Pages,
Netlify, Vercel), open it on the phone and use "Add to Home Screen" — same app as a PWA.

## Data & backups

Everything is stored in `localStorage` under `x-money:*` keys.
Use **Settings → Export backup** before changing phone or clearing browser data,
and **Import backup** to restore.
