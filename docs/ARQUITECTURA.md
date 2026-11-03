# Arquitectura (estado a v2.5.2)

Angular 22 (standalone + Signals), SCSS, Capacitor/Android y PWA. Hoy 100 % local; desde el prompt 00b la fuente de
verdad pasa a ser `x-core` con copia local por dispositivo.

## Entidades y claves de almacenamiento (`x-money:*`)

| Clave | Modelo (`src/shared/models`) | Servicio dueño |
|---|---|---|
| `transactions` | `TransactionModel` (income/expense/transfer, `fee`, `currency`) | `TransactionService` |
| `accounts` | `AccountModel` (cash/bank/card/savings, `cardKind`, `bankKind`, `currency`, `linkedAccountId`) | `AccountService` |
| `categories` | `CategoryModel` (ids `cat-*` por defecto, `custom-*` del usuario) | `CategoryService` |
| `budgets` | `BudgetModel` (límite mensual por categoría) | `BudgetService` |
| `recurring` | `RecurringModel` | `RecurringService` |
| `settings` | `{currency, taxPercent}` | `SettingsService` |
| `lock` | hash del PIN | `LockService` |
| `lang` | `'en' \| 'es'` | `TranslateService` |

Catálogos estáticos: `shared/data/banks.ts`, `default-accounts.ts`, `default-categories.ts`.

## Quién depende de quién

```
StorageService (localStorage + espejo en Capacitor Preferences)
  ├─ AccountService
  │    └─ TransactionService (saldos, resúmenes, totales por categoría)
  │         ├─ RecurringService (publica ocurrencias vencidas al inyectarse)
  │         │    └─ InsightsService (también usa TransactionService)
  │         └─ ExportService (+ CategoryService, AccountService): CSV y compartir
  ├─ CategoryService · BudgetService · LockService · TranslateService
  └─ SettingsService (además exporta/importa claves directo por StorageService)
Páginas (src/app/pages) → servicios. main.ts restaura localStorage desde Preferences antes de arrancar.
```

Los cálculos de dinero viven hoy mezclados en `TransactionService` y en componentes (`budgets.ts`, `home.ts`); ver
riesgos RK-7 y RK-10 en `docs/AUDITORIA-2026-11.md`.

## Capas objetivo

```
shared/domain        funciones puras (sin Angular ni almacenamiento) + shared/utils/money.ts
      ↓
shared/services      servicios con signals que llaman al dominio
      ↓
capa de datos        StorageService → copia local + sincronización con x-core (prompt 00b)
      ↓
pages / ui           solo muestran; no calculan dinero en plantillas
```

## Qué datos son sincronizados y cuáles del dispositivo

_(Se llena en el prompt 00b. Propuesta de partida en `docs/AUDITORIA-2026-11.md` §4.1: sincronizables
`transactions`, `accounts`, `categories`, `budgets`, `recurring`, `settings`; solo del dispositivo `lock`, `lang`.)_

## Pruebas

`npm test` (vitest vía `@angular/build:unit-test`). `shared/testing/` tiene builders y `MemoryStorage` + `boot()`
para arrancar servicios sobre un almacenamiento en memoria; `shared/characterization/` fija el comportamiento actual.
