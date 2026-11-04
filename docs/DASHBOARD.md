# Dashboard (2.11.0)

El dashboard **no calcula dinero por su cuenta**: `DashboardService` compone lo que ya calculan el ledger,
`NetWorthService`, `CreditCardService`, `IncomeService`, `BudgetService` y `FixedExpenseService`, y las funciones puras
de `src/shared/domain/dashboard.ts`. Cada indicador es un `Indicator`:

```ts
{ id, label, value | null, display: 'money' | 'percent', currency: 'DOP',
  components[]: { label, amount, kind: 'data' | 'estimate' | 'excluded', note? },
  formula, sources[], estimate, available, missing? }
```

- `available: false` → el indicador **se oculta** (su módulo no existe todavía). Nunca se dibuja un cero falso.
- `value: null` + `missing` → el módulo existe pero faltan datos: la tarjeta dice qué falta y cómo registrarlo.
- Los componentes `excluded` se muestran para que la exclusión sea visible; **no** forman parte del valor.
- Todo se calcula en RD$ (las estadísticas son RD$); RD$ y US$ nunca se suman.
- Cada indicador abre «¿Cómo se calculó?» (`IndicatorSheetComponent`, reutilizable en el prompt 09).

## Los diez indicadores

| # | Indicador | Fórmula | Fuente | Estado |
|---|---|---|---|---|
| 1 | Ingresos del mes | Ingreso **personal neto** recibido en el mes (nómina, bonos, independientes, extraordinarios, otros). Las ventas comerciales se muestran aparte como ingreso **bruto** y no suman. Sin transferencias, sin préstamos desembolsados, sin beneficios no monetarios. Se muestra además el garantizado (estimación). El ingreso **sin clasificar** no cuenta hasta clasificarlo; si es todo lo que hay, el valor es «sin datos», no cero. | `IncomeService.monthBreakdown`, `.capacity` | dato (el garantizado es estimación) |
| 2 | Gastos del mes | Gastos reales del mes, separados en fijos y variables (naturaleza de la categoría o del movimiento). La comisión del banco es gasto variable. **Sin** transferencias, **sin** pagos de tarjeta (regla 3), sin reversos ni ajustes. Costos de operaciones comerciales: los conecta el prompt 06. | `TransactionService`, `domain/stats`, `domain/categories` | dato |
| 3 | Ganancias comerciales | Beneficio neto del mes = precio − costo − gastos de cada venta (operaciones de negocio 2.12.0 + ventas comerciales manuales de ingresos). Una venta sin costo no tiene beneficio (se cuenta aparte). Oculto si no hay ventas comerciales. | `IncomeService.monthBreakdown` / módulo 06 | dato |
| 4 | Capital invertido en negocios | Inventario a costo sin vender. **Oculto** hasta el prompt 06. | módulo 06 | dato |
| 5 | Dinero disponible | Patrimonio líquido − pagos de tarjeta que vencen en 30 días (saldo pendiente de cada estado de cuenta) − fijos pendientes del mes − dinero apartado en objetivos (prompt 07; fuera de la fórmula hasta que exista). Se muestran **ambos** números: líquido y disponible. Los beneficios no monetarios nunca entran (regla 4). | `NetWorthService`, `CreditCardService`, `FixedExpenseService` | dato (calendario conocido) |
| 6 | Ahorros acumulados | Saldo de las cuentas de ahorro + aportes a objetivos que **no** estén ya dentro de una cuenta de ahorro (nunca dos veces). Oculto sin cuentas de ahorro ni objetivos. | `TransactionService.accountBalance` / módulo 07 | dato |
| 7 | Deudas pendientes | Balance utilizado de tarjetas de crédito + saldo de préstamos (prompt 08). La deuda en US$ se muestra aparte. Oculto sin tarjetas ni préstamos. | `CreditCardService.totalOwed` / módulo 08 | dato |
| 8 | Utilización de tarjetas | Balance utilizado ÷ límite, consolidado y por tarjeta (RD$). 30 % / 90 % son «referencia usual», editable por tarjeta. Sin límite: «sin datos». | `CreditCardService.utilization` | dato |
| 9 | Presupuesto restante | Suma de los límites del mes (con el dinero movido) − lo gastado en esas categorías (sin reversos). Sin presupuestos: «sin datos». | `BudgetService.remainingThisMonth` | dato |
| 10 | Patrimonio financiero | Patrimonio neto (líquido − deuda de tarjetas; los préstamos se suman en el 08). El **capital comercial** se muestra aparte y no se suma (regla 6). | `NetWorthService` | dato |

## Contrato para los prompts 06, 07 y 08

Los módulos que todavía no existen entregan sus cifras con `DashboardService.provide({...})` y el indicador aparece:

| Campo | Lo entrega | Qué activa |
|---|---|---|
| `businessCapital` | 06 | indicador 4 |
| `commercialProfit` | 06 | indicador 3 (reemplaza al cálculo provisional) |
| `commercialWorkingCapital` | 06 | línea «capital comercial (aparte)» del indicador 10 |
| `goalsReserved` | 07 | resta en «dinero disponible» (5) |
| `goalsSaved` | 07 | suma en «ahorros acumulados» (6): solo lo que no esté en una cuenta de ahorro |
| `loanBalance` | 08 | suma en «deudas pendientes» (7) |

## Análisis (`/analysis`)

| Análisis | Función pura | Notas |
|---|---|---|
| Evolución 12 meses | `monthlyFlow` | ingresos y gastos como en `summarize`; el mes en curso va como parcial |
| Gasto por categoría | `TransactionService.categoryTotals` | el mismo cálculo de Estadísticas |
| Fuentes de ingreso | `IncomeService.weights`, `stabilityOf` | peso (12 meses) con estabilidad declarada y calculada |
| Evolución de ahorros | `savingsHistory` | se reconstruye con el ledger al cierre de cada mes; sin snapshots. Limitación: el saldo inicial de la cuenta cuenta desde el primer mes. Oculto sin cuentas de ahorro |
| Comparar dos meses | `compareMonths` | diferencia absoluta y %; sin % si el primer mes es cero |
| Flujo de efectivo 30/60/90 | `cashflowProjection` | **Estimación**: saldo líquido de partida + ingresos garantizados esperados (+ promedio de variables solo con interruptor) − fijos por vencer − estados de cuenta por vencer − gasto variable al ritmo semanal reciente. Banda: peor caso = mayor tasa de gasto y sin ingreso variable; mejor caso = menor tasa. Marca el día en que el saldo cae por debajo de cero y de un colchón configurable. Supuestos listados en pantalla |
| Gastos inusuales | `unusualExpenses` | por categoría, movimientos del mes por encima de Q3 + 1.5×IQR del historial de 6 meses (≥ 8 movimientos) o de 2× la mediana (3–7), y de un mínimo configurable (500 por defecto). Con menos de 3 meses con gastos: «Historial insuficiente». Cada marca dice por qué |

## Rendimiento (5.000 movimientos, `dashboard-perf.spec.ts`)

Ver el reporte del prompt 05: los cálculos de Home existentes cuestan ~5 ms; los diez indicadores ~9 ms la primera
vez, 0 ms memoizados y ~12 ms tras agregar un movimiento; todos los análisis juntos ~23 ms. Los indicadores se cargan
con `@defer (on idle)` para no retrasar el primer pintado de Home.
