# Arquitectura (estado a v2.7.0)

Angular 22 (standalone + Signals), SCSS, Capacitor/Android y PWA (web e iPhone). Desde la 2.6.0 la fuente de verdad es
`x-core` (schema `xmoney`, solo accesible por la Edge Function `xmoney-api`) y cada dispositivo guarda una copia local
en IndexedDB para trabajar sin conexión. Sin `apiUrl` configurada la app funciona en modo solo local (como la 2.5.x).

## Entidades y claves de almacenamiento (`x-money:*`)

Registro único en `src/shared/data-layer/registry.ts`. **Toda colección nueva se registra allí como sincronizada o
"solo del dispositivo"** (una clave sin registrar se reporta con `console.error` y no se sincroniza).

| Clave | Modelo (`src/shared/models`) | Servicio dueño | Sincronización |
|---|---|---|---|
| `transactions` | `TransactionModel` (income/expense/transfer, `fee`, `currency`) | `TransactionService` | **sincronizada** (1 registro por movimiento) |
| `accounts` | `AccountModel` | `AccountService` | **sincronizada** |
| `categories` | `CategoryModel` (`cat-*` por defecto, `custom-*`) | `CategoryService` | **sincronizada** |
| `budgets` | `BudgetModel` | `BudgetService` | **sincronizada** |
| `recurring` | `RecurringModel` | `RecurringService` | **sincronizada** |
| `audit` | `AuditEvent` (solo adición, máx. 2.000; cada evento nombra su dispositivo) | `AuditLogService` | **sincronizada** |
| `incomeSources` | `IncomeSourceModel` (tipo, estabilidad, periodicidad, método, verificabilidad, montos esperados) | `IncomeSourceService` | **sincronizada** |
| `benefits` | `BenefitModel` (beneficio no monetario con sus notas de uso embebidas; nunca es dinero) | `BenefitService` | **sincronizada** |
| `loans` | `LoanModel` (préstamo con su tabla de amortización y sus pagos; lo adeudado se deriva) | `LoanService` | **sincronizada** |
| `loanSimulations` | `LoanSimulationModel` (simulación u oferta guardada con nombre) | `LoanService` | **sincronizada** |
| `loanSettings` | `LoanSettings` (niveles de ingreso, descuento de prudencia, umbrales) | `LoanService` | **sincronizada** (doc) |
| `goals` | `GoalModel` (objetivo con sus aportes y retiros embebidos; apartado virtual) | `GoalService` | **sincronizada** |
| `businessOperations` | `BusinessOperationModel` (lote o artículo con sus ventas, gastos y reserva embebidos) | `BusinessService` | **sincronizada** |
| `businessWithdrawals` | `BusinessWithdrawal` (ganancia pasada a uso personal; nota neutra) | `BusinessService` | **sincronizada** |
| `contacts` | `ContactModel` (compradores y proveedores, solo referencia) | `BusinessService` | **sincronizada** |
| `buckets` | `BudgetBucketModel` (bloques de distribución: categorías, % o monto, aporte manual por mes) | `BudgetService` | **sincronizada** |
| `budgetMoves` | `BudgetMoveModel` (dinero movido entre bloques o categorías dentro de un mes; se puede deshacer) | `BudgetService` | **sincronizada** |
| `statements` | `CardStatementModel` (periodos cerrados de tarjeta; id `stmt-<tarjeta>-<moneda>-<corte>`, igual en todos los dispositivos) | `CreditCardService` | **sincronizada** |
| `conflicts` | `ConflictModel` (versiones que perdieron un conflicto; las escribe el servidor) | `ConflictService` | **sincronizada** |
| `settings` | `{currency, taxPercent}` | `SettingsService` | **sincronizada** (documento) |
| `lang` | `'en' \| 'es'` | `TranslateService` | **sincronizada** (documento) |
| `lock` | hash del PIN | `LockService` | **solo de este dispositivo** |
| `device-prefs` | `{lastExportAt, reminderDays, cardAlerts}` | `BackupReminderService` | **solo de este dispositivo** |

Solo del dispositivo además (en el almacén `device` de IndexedDB o en Preferences/localStorage, nunca suben):
id del dispositivo, cursor de sincronización, cola de salida (outbox), revs conocidas, cuenta enlazada, estado de la
migración, tokens de sesión (refresco en Preferences en la app y localStorage en la web; el de acceso solo en memoria).
Los saldos y totales **no se guardan ni se sincronizan**: se derivan de los movimientos (regla 9).

Catálogos estáticos: `shared/data/banks.ts`, `default-accounts.ts`, `default-categories.ts`.

## Quién depende de quién

```
StorageService (copia local en IndexedDB + espejo a Preferences en Android; get/set síncronos desde una caché en memoria)
  │   └─ envía cada escritura de una clave sincronizada al SyncEngine (diferencia por registro → outbox)
  ├─ AccountService → TransactionService → RecurringService → InsightsService · ExportService
  ├─ CategoryService · BudgetService · LockService · TranslateService · SettingsService · ConflictService · BackupReminderService
  ├─ ApiService (XMoneyApiClient: fetch propio, token en memoria, refresco único en vuelo)
  ├─ SyncService (SyncEngine + disparadores: abrir, primer plano, reconexión, tras editar, cada 5 min)
  └─ AuthService (sesión, registro, recuperación) → SyncService
Los servicios se suscriben con storage.watch(clave) para reflejar lo descargado de otro dispositivo.
Páginas (src/app/pages) → servicios. APP_INITIALIZER: hidrata StorageService (y migra 2.5.x → IndexedDB) y luego AuthService.init().
```

Servidor: `supabase/functions/xmoney-api/` (`lib/api.ts` lógica pura sobre la interfaz `Db`; `lib/pg-db.ts` SQL
parametrizado; `index.ts` HTTP/CORS/Deno) y `supabase/migrations/*_xmoney_*.sql`.

Los cálculos de dinero viven hoy mezclados en `TransactionService` y en componentes (`budgets.ts`, `home.ts`); ver
riesgos RK-7 y RK-10 en `docs/AUDITORIA-2026-11.md`.

## Dominio puro (`src/shared/domain/`, `utils/money.ts`)

`dates.ts` (calendario UTC, bisiestos) · `ledger.ts` (saldo, saldo por moneda, saldo a una fecha, total, neto de huérfanos) ·
`stats.ts` (ingresos/gastos/categorías, qué cuenta) · `validation.ts` (todas las reglas de guardado, devuelve un código) ·
`reversal.ts` (inverso, grupos atómicos, partes) · `transfers.ts` (transferencias no marcadas) · `income-patterns.ts` ·
`networth.ts` (patrimonio líquido y neto) · `reconcile.ts`. Sin Angular ni almacenamiento; cada archivo con pruebas.

## Esquema versionado y migraciones (2.7.0)

- Versión de esquema de los datos: `CLIENT_SCHEMA_VERSION` (`data-layer/registry.ts`, hoy 2). Cada registro sincronizado lleva
  `schema_version`; `xmoney.meta` guarda la del servidor (una app más vieja queda en solo lectura).
- Migraciones en `data-layer/migrations.ts`: funciones puras e idempotentes **por registro**; sirven para la copia local, la cola de
  salida, los registros descargados de otro dispositivo (`applyRemote`) y los respaldos importados.
- `MigrationService` corre en el `APP_INITIALIZER` **antes** de que cualquier servicio lea datos: snapshot completo (se conservan
  los dos últimos), migra en memoria, escribe, sube la versión local y marca "subir lo migrado". Si algo falla restaura el snapshot,
  la app arranca con los datos viejos, `syncBlocked` impide subir nada y se muestra un aviso discreto.
- Orden con sincronización: migrar local → (al sincronizar) poner en cola todos los registros migrados → vaciar la cola → **solo
  entonces** subir la versión a `xmoney.meta` (`ApiTransport.raiseSchema`). Diferencia con el enunciado ("sincronizar y vaciar la
  cola" antes de migrar): la cola pendiente se **migra también** en lugar de vaciarse primero, así la migración funciona sin conexión.
- Para el siguiente cambio de forma: sumar una `Migration` con `version = N+1`, subir `CLIENT_SCHEMA_VERSION`, y probarla con
  fixtures de la forma anterior (`testing/fixtures.ts`).

## Modelo de sincronización

- **Tabla genérica `xmoney.records`** (`account_id, collection, id, data jsonb, schema_version, rev, updated_at,
  client_updated_at, device_id, deleted_at`). Motivo: los datos cambian de forma en casi cada prompt de la ronda;
  una tabla genérica evita una migración de Postgres por módulo en un proyecto compartido, y la integridad
  financiera la imponen la capa de dominio y las pruebas (los saldos nunca se guardan). Si hicieran falta consultas
  analíticas en el servidor se evaluaría pasar colecciones concretas a relacionales.
- `rev` y `updated_at` los asigna **el servidor** (trigger); nunca se confía en el reloj del dispositivo para el
  orden de descarga. `client_updated_at` solo decide conflictos y se limita a "ahora + 5 min".
- **Subida:** outbox persistente de operaciones por registro (upsert por clave primaria ⇒ idempotente), por lotes de
  200, con reintentos con retraso exponencial. **Descarga:** cursor por `rev`, en páginas de 500.
- **Conflictos:** gana el `client_updated_at` más reciente (empate: el de mayor `rev` del servidor); el perdedor se
  guarda completo en la colección `conflicts` (Ajustes → Historial de cambios, "Restaurar esta versión"). Un borrado
  contra una edición más nueva pierde y se informa. El mismo contenido en dos dispositivos (p. ej. una ocurrencia
  recurrente, que tiene id determinístico `rec-<regla>-<fecha>`) no es conflicto.
- **Versión de esquema:** cada registro lleva `schema_version` y `xmoney.meta` guarda la del servidor. Una app más
  vieja que el servidor queda en solo lectura ("Actualiza X Money"). Orden para cambios de esquema futuros: migrar en
  local, subir por lotes y solo entonces subir `schema_version` (`sync/meta`).
- **Primera sincronización** (`data-layer/link.ts`): servidor vacío + datos locales → "Subir mis datos" (respaldo JSON,
  lotes con progreso reanudable, verificación de conteos); servidor con datos + dispositivo virgen → descarga;
  datos en ambos lados → el usuario elige "quedarme con lo del servidor" o "unir por id", siempre tras respaldo.

## Capas objetivo

```
shared/domain        funciones puras (sin Angular ni almacenamiento) + shared/utils/money.ts
      ↓
shared/services      servicios con signals que llaman al dominio
      ↓
capa de datos        StorageService → copia local (IndexedDB) + SyncEngine ⇄ xmoney-api ⇄ x-core (2.6.0)
      ↓
pages / ui           solo muestran; no calculan dinero en plantillas
```

## Qué datos son sincronizados y cuáles del dispositivo

Ver la tabla de "Entidades y claves de almacenamiento" arriba y `src/shared/data-layer/registry.ts`.

## Pruebas

`npm test` (vitest vía `@angular/build:unit-test`; incluye `src/server-tests/` con la lógica de `xmoney-api` y `src/shared/data-layer/` con la sincronización contra un servidor en memoria). `shared/testing/` tiene builders y `MemoryStorage` + `boot()`
para arrancar servicios sobre un almacenamiento en memoria; `shared/characterization/` fija el comportamiento actual.
