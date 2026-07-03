# X Money 💰

Personal money manager. **100% local** — no backend, no account, no bank sync.
Your data never leaves your device. Installable on your phone as a PWA and works fully offline.

Built with Angular (standalone components + Signals), SCSS, and localStorage. See [PLAN.md](PLAN.md) for the research and architecture.

## Features

- ➕ Fast expense/income entry with categories, accounts, date and notes
- 🏦 Full account management: cash, bank accounts, credit & debit cards (with last-4) and savings, linked to a catalog of 17 banks (Dominican + international) with real logos bundled offline; per-account balances and transaction history
- 🔗 Debit cards can be linked to a bank account — card purchases deduct from the bank account (Money Manager-style)
- 💱 Accounts in RD$ or US$; credit cards can be dual-currency with per-transaction currency and separate US$ balances (no fake conversions)
- 🐜 Insights: "gastos hormiga" detection, real cost of recurring services (monthly/yearly), and month-over-month spending warnings
- 📅 Stats in Month or Year mode with a 12-month yearly report and per-account filtering
- 🔄 Transfers between accounts (excluded from income/expense stats)
- 🔁 Recurring transactions (daily/weekly/monthly/yearly) with automatic catch-up posting; edit/pause/delete in Settings
- 🏷️ 26 built-in categories (incl. Hobby, Car project) + create your own with custom name, emoji and color
- 🔎 Search and filter history by text, category, or account
- 📈 6-month income vs expense trend chart · ⚠️ over-budget alerts on Home
- 🔐 Optional PIN app lock (locks on start and on background)
- 🌎 English / Español
- 🛡️ Data mirrored to native storage (survives WebView cache clearing) · CSV export via Android share sheet
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

### Release build (Play Store)

Release builds are signed with `android/x-money-release.jks` configured through
`android/keystore.properties`. **Both files are gitignored — back them up somewhere safe.**
Losing the keystore means you can never update the app on the Play Store again.

```bash
cd android
gradlew.bat assembleRelease   # signed APK  → app/build/outputs/apk/release/app-release.apk
gradlew.bat bundleRelease     # signed AAB  → app/build/outputs/bundle/release/app-release.aab
```

Upload the **`.aab`** to the [Google Play Console](https://play.google.com/console)
(one-time $25 developer account). The `.apk` is for installing directly on a phone.
Bump `versionCode`/`versionName` in `android/app/build.gradle` for every Play Store update.

**Alternative (no APK):** deploy `dist/x-money/browser` to any static host (GitHub Pages,
Netlify, Vercel), open it on the phone and use "Add to Home Screen" — same app as a PWA.

## Data & backups

Everything is stored in `localStorage` under `x-money:*` keys.
Use **Settings → Export backup** before changing phone or clearing browser data,
and **Import backup** to restore.
