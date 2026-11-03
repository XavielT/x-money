# Auditoría de código — noviembre 2026 (base: v2.5.1, escrita en v2.5.2)

> **Actualización 2.6.0:** el hueco "no es atómico / duplica tras un fallo de guardado" de C4 (y el riesgo de duplicar
> recurrentes entre dispositivos al sincronizar) quedó corregido: cada ocurrencia usa el id determinístico
> `rec-<regla>-<fecha>` y `TransactionService.add` es idempotente por id. El resto de los hallazgos sigue vigente.

Alcance: se leyó todo `src/` (modelos, servicios, páginas, componentes). No se corrigió nada de producción: lo
que sigue es lo que el código hace HOY, con las pruebas de caracterización de
`src/shared/characterization/integrity.spec.ts` que lo fijan (las que documentan una violación se llaman
`KNOWN GAP: …` y apuntan a este documento).

Aviso de método: el árbol de trabajo trae ~100 archivos "modificados" solo por fin de línea (CRLF/LF). Se usó
`git diff --ignore-space-at-eol` y no se normalizó nada.

Nota sobre las columnas "Lo cubre": las propuestas siguen `docs/ROADMAP.md` (alcance de cada prompt por su título).
Los textos de los prompts 01–11 no estaban disponibles al escribir esto, así que son una asignación propuesta, no
verificada; deben confirmarse al correr cada prompt.

---

## 1. Estado de los bloques de las notas (N1–N11)

| Nota | Estado | Qué existe / dónde | Reutilizable | Duplicación o riesgo |
|---|---|---|---|---|
| N1 Múltiples fuentes de ingreso | **parcial** | Categorías de ingreso fijas (`data/default-categories.ts:25-31`: Salary, Freelance, Business, Investments…); el ingreso es un `TransactionModel` con `type:'income'` y una categoría; las reglas recurrentes admiten ingresos (`recurring.model.ts:6`). | `RecurringService`, `CategoryService`, `TransactionModel`. | No hay entidad "fuente de ingreso" ni noción de ingreso variable vs fijo: hoy un ingreso variable y uno fijo son indistinguibles (R7). |
| N2 Beneficios no monetarios | **falta** | Nada. | — | Riesgo de modelarlos como `income`: inflaría el efectivo (R4). Deben ser entidad aparte. |
| N3 Negocios independientes | **falta** | Solo la categoría de ingreso "Business" (`default-categories.ts:27`). Sin inventario, ventas ni costo. | `AccountService` (cuentas del negocio), categorías. | Riesgo: ventas registradas como ingreso personal (R5, R6). |
| N4 Gastos fijos / variables / irregulares | **parcial** | Gastos recurrentes (`recurring.service.ts`) ≈ fijos; categorías de gasto; insights de "gastos hormiga" y costo de suscripciones (`insights.service.ts:36-66`). | `RecurringService`, `InsightsService`. | Sin clasificación fijo/variable/irregular (R8). La lógica "gasto por categoría del mes" está copiada en 3 sitios: `transaction.service.ts:147-162`, `budgets.ts:40-44`, `home.ts:46-53`. |
| N5 Tarjetas de crédito | **parcial** | Cuenta tipo `card` con `cardKind:'credit'` (`account.model.ts:1-2,13`), moneda dual RD$+US$ (`account.model.ts:8`), formulario en `accounts.ts:31-36`. | `AccountModel`, saldo por moneda (`transaction.service.ts:101-120`). | Sin límite, día de corte/pago, estado de cuenta, intereses, pago mínimo. El pago de la tarjeta puede registrarse como gasto (C1). Una cuenta dual no puede tener saldo inicial US$ (C8). |
| N6 Cuentas y movimientos internos | **parcial** | Cuentas por tipo/banco, tarjeta débito enlazada (`linkedAccountId`, `account.service.ts:44-50`), transferencias como registro único (`transaction.model.ts:2-6`), comisión/DGII (`fee`). | `TransactionService.accountBalance`, `AccountService.effectiveOwnerId`. | Borrar cuenta deja huérfanos y cambia el total (C5). Sin conciliación, sin archivar cuentas. |
| N7 Presupuestos y distribución | **parcial** | Presupuesto mensual por categoría (`budget.model.ts`, `budgets.ts`, alertas en `home.ts:44-66`). | `BudgetService`. | No se calcula sobre ingresos reales; mezcla monedas, ignora comisiones y arrastra ruido de flotantes (C3, C8, C9). |
| N8 Simulador de préstamos | **falta** | Nada. | — | Debe ser dominio puro, marcado como estimación (R10). |
| N9 Objetivos y fondo de emergencia | **falta** | Solo existe el tipo de cuenta `savings`. | `AccountModel` tipo `savings`. | Evitar duplicar "ahorro" como cuenta y como objetivo. |
| N10 Dashboard | **parcial** | Home (`home.ts`, `home.html`): balance total, ingresos/gastos del mes, top categorías, alertas de presupuesto, recientes; Stats con dona, 6 meses y reporte anual (`stats.ts`). | `TransactionService.monthSummary/yearSummary/categoryTotals`. | Cálculos duplicados en componentes (ver N4). El total de la tarjeta suma saldos de crédito como parte del "balance". |
| N11 Inteligencia y recomendaciones | **parcial** | `InsightsService`: gastos hormiga (umbral 2 % / mín. 100), costo mensual/anual de suscripciones, variación mes a mes. | `InsightsService`. | `subscriptionCost` usa factores 30.44 y 4.35 y la pantalla lo muestra como "≈" sin supuestos (`stats.html:136-143`): proyección no marcada como estimación (R10). |

---

## 2. Reglas de integridad y casos probados

Cada caso (C1–C9) tiene pruebas en `src/shared/characterization/integrity.spec.ts`. "Hoy" = lo que hace el código.

| Regla | Hoy | Caso |
|---|---|---|
| R1 Transferencia ≠ ingreso/gasto | **Se cumple** (la comisión/impuesto del movimiento sí cuenta como gasto "Bank fees", ver C3). | C2, C3, C6 |
| R2 Compra con tarjeta = un gasto | **Se cumple.** | C1 |
| R3 Pago de tarjeta no recontabiliza | **Parcial:** se cumple solo si el usuario lo registra como transferencia. Si lo registra como gasto, cuenta dos veces. | C1 |
| R4 Beneficios no monetarios ≠ efectivo | No aplica todavía (no existen). | — |
| R5 Ventas ≠ ganancia neta | No aplica todavía. | — |
| R6 Inventario comercial separado | No aplica todavía. | — |
| R7 Ingresos variables ≠ recurrentes garantizados | No aplica todavía (no hay distinción; ver N1). | — |
| R8 Gastos ocasionales conservan naturaleza variable | No aplica todavía (no hay clasificación). | — |
| R9 Saldos a partir de movimientos consistentes | **Parcial:** los saldos se derivan de los movimientos (`transaction.service.ts:101-139`) pero se violan en C4–C9. | C4–C9 |
| R10 Proyecciones = estimaciones | **Parcial:** única proyección (`subscriptionCost`) sin supuestos visibles. | N11 |

### C1 — Compra con tarjeta de crédito y luego pago de la tarjeta
- La compra es un gasto en la cuenta tarjeta; su saldo queda negativo y el total baja (`transaction.service.ts:101-139`).
- Pagarla con una **transferencia** banco→tarjeta no cuenta dos veces: ingresos/gastos intactos, banco −X, tarjeta +X, total igual.
- **KNOWN GAP:** no existe un tipo "pago de tarjeta". Registrarlo como gasto (la otra única opción) duplica el gasto del mes (6 000 en vez de 3 000) y el total baja el doble. Nada en el formulario lo impide ni lo avisa.

### C2 — Transferencia entre cuenta propia y tarjeta
- Banco→tarjeta: no es ingreso ni gasto, no aparece en categorías; el total no cambia. Correcto.
- Banco→su propia tarjeta de débito vinculada: ambos extremos resuelven a la misma cuenta, no se mueve nada (salvo la comisión).

### C3 — Comisión/impuesto DGII (`fee`)
- La comisión sale siempre de la cuenta origen (`transaction.service.ts:110`), baja el total (`:129`) y se suma al gasto del mes (`:140`) y a la categoría `cat-bank-fees` en stats (`:155-159`), aunque el movimiento sea una transferencia. Aparece en: Home, Transacciones, Stats (mes/año), saldo de cuentas.
- **KNOWN GAP:** el presupuesto de "Bank fees" nunca ve las comisiones (`budgets.ts:40-44` solo suma `amount`, no `fee`) pero Stats sí → cifras que no cuadran.
- **KNOWN GAP:** la comisión de una transacción en US$ baja el saldo US$ pero no aparece en ninguna estadística (las stats filtran solo RD$).
- `cat-bank-fees` es un id escrito a mano en el servicio (`:158`).

### C4 — Recurrentes con catch-up
- Abrir la app dos veces no duplica: `nextDate` se avanza y persiste. Fin de mes ancla al día original (31 → 28 feb → 31). Tope de 500 ocurrencias por arranque.
- **KNOWN GAP:** adelantar el reloj del teléfono publica meses futuros de forma permanente; devolver el reloj no los revierte ni los marca.
- **KNOWN GAP:** no es atómico. Cada ocurrencia se guarda como transacción al instante (`recurring.service.ts:30`) y la regla se guarda al final (`:49`). Si falla el guardado de la regla (p. ej. cuota de localStorage) o el proceso muere en medio, el próximo arranque republica las mismas ocurrencias (probado: 2 → 4). Con sincronización (00b) dos dispositivos harían lo mismo, cada uno con UUID distinto.
- **KNOWN GAP:** una regla sigue publicando en una cuenta ya borrada.

### C5 — Borrar una cuenta con movimientos / la cuenta destino de una transferencia
`AccountService.remove` (`account.service.ts:86`) solo quita la cuenta.
- **KNOWN GAP:** los movimientos quedan huérfanos y el **balance total cambia**: se pierde el saldo inicial de la cuenta pero se siguen restando sus gastos (1 400 → 400 en la prueba). La confirmación del usuario dice que "mostrarán 'Unknown'", pero no avisa del efecto en el total.
- **KNOWN GAP:** borrar el destino de una transferencia: el total no se mueve (ignora transferencias) pero la suma de saldos por cuenta sí (900 vs 700): el dinero "salió" del banco y no llegó a ninguna parte.
- **KNOWN GAP:** borrar el banco de una tarjeta de débito vinculada reasigna en silencio todo su historial a la tarjeta (`effectiveOwnerId` cae a la tarjeta), con `linkedAccountId` colgando.

### C6 — Editar o borrar un movimiento que es parte de una transferencia
- Una transferencia es **un solo registro** (`accountId` + `toAccountId`): borrar o editar el monto cambia ambos lados a la vez; convertirla en gasto deja de acreditar el destino. Correcto.
- **KNOWN GAP:** el servicio no valida nada; solo el formulario (`transaction-form.ts:157-169`). `add/update` aceptan transferencia a la misma cuenta, monto negativo (un gasto negativo es un ingreso encubierto), US$ en cuenta solo RD$ y `NaN`; **un solo `NaN` contamina total, saldos y resúmenes**.

### C7 — Importar un respaldo mal formado o de versión vieja
- Rechaza JSON inválido, `null` y otra app sin tocar datos. Un respaldo viejo (cuentas sin tipo/moneda/`cardKind`, sin `recurring`) se importa y las migraciones de `AccountService` lo completan al cargar. Exportar → borrar → importar restaura igual. El respaldo no incluye PIN ni idioma.
- **KNOWN GAP:** solo se comprueba `app === 'x-money'` (`settings.service.ts:58`). Una forma incorrecta (p. ej. transacciones sin `date`) se acepta y la app falla en la siguiente carga (`forMonth` lanza).
- **KNOWN GAP:** `version` se ignora (acepta `99`); la importación es una fusión por clave, no un reemplazo (las claves ausentes conservan los datos actuales: queda un estado mezclado) y no es atómica (`:59-61`).

### C8 — USD y DOP en la misma cuenta dual
- Saldos separados por moneda, total US$ aparte, y los movimientos US$ no entran en resúmenes RD$ (sin conversiones inventadas). Correcto.
- **KNOWN GAP:** una cuenta dual solo puede iniciar con saldo en RD$ (`transaction.service.ts:103`: el saldo inicial va a DOP salvo cuenta `USD`).
- **KNOWN GAP:** el presupuesto (RD$) y las alertas de Home cuentan los gastos en US$ de la misma categoría (`budgets.ts:40-44`, `home.ts:46-53` no filtran moneda).

### C9 — Flotantes
- **KNOWN GAP:** no hay redondeo en ninguna suma: `0.1 + 0.2` da `0.30000000000000004` en `monthSummary`, `accountBalance` y `totalBalance` (los `number` pipes de la UI lo ocultan al mostrar, no al comparar).
- **KNOWN GAP:** un presupuesto de exactamente 0.30 se marca "excedido" tras gastar 0.10 + 0.20 (`budgets.ts:45`, razón 1.0000000000000002). Único redondeo existente: la comisión en `applyDgiiFee` (`transaction-form.ts:125-129`).
- `shared/utils/money.ts` (creado en este prompt, sin usar aún en producción) es el redondeo a 2 decimales que usarán los prompts siguientes.

---

## 3. Riesgos, por gravedad

| # | Riesgo | Cobertura propuesta (ver nota arriba) |
|---|---|---|
| RK-1 | Importar respaldo: forma no validada, fusión por clave, no atómico; puede dejar la app inutilizable al arrancar (C7). | 00b (capa de datos, migraciones) + 01 (esquema versionado y validación) |
| RK-2 | Sumas sin redondeo y `NaN` que contamina todo; sin validación en servicios (C6, C9). | 01 |
| RK-3 | Borrar cuentas: huérfanos, total que cambia, reasignación silenciosa de tarjeta débito (C5). | 01 |
| RK-4 | Recurrentes no atómicas y vulnerables al reloj; con sincronización multi-dispositivo duplicarían (C4). | 01 (idempotencia por ocurrencia); coordinar con 00b |
| RK-5 | Pago de tarjeta como gasto duplica; no existe modelo de tarjeta de crédito (C1). | 02 |
| RK-6 | `StorageService.set` no captura errores de cuota (`storage.service.ts:23`); cada alta reescribe todo el arreglo (el catch-up de 500 ocurrencias hace 500 escrituras completas). Con ~20 000 movimientos se acerca al tope de ~5 MB de localStorage (ver §4.1). | 00b |
| RK-7 | Presupuestos y alertas mezclan monedas e ignoran comisiones; razón con flotantes (C3, C8, C9). | 04 |
| RK-8 | Cuenta dual sin saldo inicial US$ (C8). | 02 |
| RK-9 | Proyección sin marcar como estimación: `subscriptionCost` (N11). | 09 (y 05 donde se muestre) |
| RK-10 | Lógica de "gasto por categoría" y de fechas (`todayIso`) copiada en varios sitios. | 04/05 (centralizar en `shared/domain`) |
| RK-11 | `wipeData` borra también PIN e idioma; `alert()/confirm()` bloqueantes; el borrado no ofrece exportar antes. | **no lo cubre ninguno** |
| RK-12 | PIN: SHA-256 sin sal de 4–8 dígitos (`lock.service.ts:44-48`), fuerza bruta trivial si alguien lee el almacenamiento del dispositivo. | **no lo cubre ninguno** |
| RK-13 | Fechas por hora local del teléfono (`todayIso`); desfases de zona horaria entre dispositivos al sincronizar. | **no lo cubre ninguno** (revisar en 00b) |

---

## 4. Inventario de datos para el prompt 00b

### 4.1 Claves `x-money:*`

Todas pasan por `StorageService` (`storage.service.ts`): `localStorage` como copia de trabajo síncrona, espejo en
Capacitor Preferences, y `main.ts` restaura desde Preferences si el WebView perdió el almacenamiento.

| Clave | Forma | Tamaño aprox. | Propuesta |
|---|---|---|---|
| `transactions` | `TransactionModel[]` (~245 B c/u con nota) | 10 000 ≈ 2.4 MB · 20 000 ≈ 4.8 MB · 50 000 ≈ 12 MB | **sincronizable** |
| `accounts` | `AccountModel[]` | 30 cuentas ≈ 5 KB | **sincronizable** |
| `categories` | `CategoryModel[]` (defaults + `custom-*`) | ~5 KB | **sincronizable** (los defaults tienen id fijo) |
| `budgets` | `BudgetModel[]` | < 2 KB | **sincronizable** |
| `recurring` | `RecurringModel[]` | < 10 KB | **sincronizable** (con idempotencia, ver RK-4) |
| `settings` | `{currency, taxPercent?}` | < 100 B | **sincronizable** |
| `lock` | hash SHA-256 del PIN (string) | 66 B | **solo de este dispositivo** (nunca sube; ya excluido del respaldo) |
| `lang` | `'en' \| 'es'` | 4 B | **solo de este dispositivo** (opción conservadora; ya excluido del respaldo) |

Tamaños medidos serializando datos sintéticos; el tope de localStorage depende del WebView (~5 MB de caracteres).

### 4.2 Datos fuera de `StorageService`
- `src/main.ts:8-31` lee/escribe `localStorage` y `Preferences` directamente (`syncDurableStorage`) para la restauración al arrancar.
- `SettingsService.exportData/importData` leen y escriben claves vía `StorageService`, pero se saltan a los servicios (los signals de las claves importadas solo se refrescan con `location.reload()`).
- El PIN (texto) solo vive en memoria del componente; el service worker (`ngsw-config.json`) cachea solo recursos estáticos.
- No hay `sessionStorage`, IndexedDB ni cookies.
