# X Money — Plan

Personal money management app, 100% local (no backend, no account, no bank sync).
Installable on the phone as a PWA ("Add to Home Screen"), works fully offline.

## 1. Research summary — how these apps work

Reference apps: **Monefy**, **Money Manager (Realbyte)**, **YNAB**, **Spendee**.

Common core loop (manual-entry trackers like Monefy):

1. **Fast transaction entry** — one screen: pick expense/income, amount, category, account, date, optional note. Speed is the #1 feature; entry must take < 5 seconds.
2. **Categories** — a fixed-but-editable set with icon + color (Food, Transport, Home, Health...). Every transaction belongs to exactly one category.
3. **Accounts / wallets** — Cash, Bank card, Savings... each with an initial balance. Balance = initial + income − expenses of that account.
4. **Dashboard** — current-month snapshot: total balance, income vs expense, spending distribution chart, recent movements.
5. **Stats** — spending by category per period (donut/bar chart), navigable by month.
6. **Budgets** — monthly limit per category with progress bar and over-budget warning (YNAB-style "give money a job", simplified).
7. **Data ownership** — local storage, JSON export/import for backup (Monefy does Drive/Dropbox sync; we do manual export).

Deliberately out of MVP scope: bank syncing, multi-currency conversion, recurring
transactions, cloud sync, passcode. Left as roadmap items.

## 2. Architecture

- **Angular 22, standalone components**, Signals for all state, SCSS, no UI framework.
- **Persistence: localStorage** through a single `StorageService` (JSON snapshot per
  collection). TODO markers left for a future HttpClient/IndexedDB upgrade.
- **PWA**: `@angular/pwa` service worker + manifest → installable, offline-first.
- Business logic lives in `shared/services`, page components only orchestrate.

### Data model (shared/models)

| Entity | Fields |
|---|---|
| `TransactionModel` | id, type (`income`\|`expense`), amount, categoryId, accountId, date (ISO), note |
| `CategoryModel` | id, name, icon (emoji), color, type (`income`\|`expense`) |
| `AccountModel` | id, name, icon, initialBalance |
| `BudgetModel` | id, categoryId, monthlyLimit |

Default categories and accounts seeded from `shared/data` on first run.

### Pages (bottom tab navigation, mobile-first)

| Route | Page | Contents |
|---|---|---|
| `/` | Home | Total balance, month income/expense, mini category chart, recent transactions |
| `/transactions` | Transactions | Month selector, list grouped by day, tap to edit, swipe-free delete button |
| `/add` · `/edit/:id` | Transaction form | Type toggle, amount keypad-friendly input, category grid, account, date, note |
| `/stats` | Stats | Donut chart (custom SVG) by category + ranked list, month navigation |
| `/budgets` | Budgets | Per-category budget bars vs current month spending, add/edit/delete budget |
| `/settings` | Settings | Currency symbol, accounts management, export/import JSON, wipe data |

### Services (shared/services)

- `StorageService` — generic localStorage read/write.
- `TransactionService` — CRUD + computed month summaries, balances, category totals.
- `CategoryService`, `AccountService`, `BudgetService` — CRUD, seeded defaults.
- `SettingsService` — currency symbol, first-run seeding flag.

## 3. Build order

1. Scaffold + PWA + git remote (`git@github.com:XavielT/x-money.git`).
2. Global styles (`:root` vars, dark theme), models, mock/default data, services.
3. Navbar + routing shell.
4. Transaction form (create/edit) → Transactions list → Home dashboard.
5. Stats (SVG donut) → Budgets → Settings (export/import/wipe).
6. PWA manifest/icons, production build, end-to-end manual test in browser
   (mobile viewport): add/edit/delete flows, persistence across reload, install-ability.

## 4. How to install on the phone

The app is static files — any of these works:

- **Same Wi-Fi**: `npm run build`, serve `dist/x-money/browser` (e.g. `npx http-server -p 8080`),
  open `http://<pc-ip>:8080` on the phone → browser menu → "Add to Home Screen".
  (Service worker needs HTTPS or localhost; for full offline install prefer the next option.)
- **Free static hosting** (GitHub Pages / Netlify / Vercel): push → open URL on phone →
  install prompt. Data still stays 100% on the device (localStorage).

## 5. Roadmap (post-MVP)

- Recurring transactions · IndexedDB migration · CSV export · charts by month trend
- Passcode lock · multi-currency · Capacitor wrapper for a real APK if ever needed
