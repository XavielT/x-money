# shared/domain

Pure financial logic. Nothing in here may import Angular, Capacitor, a service
or storage; it takes plain data in and returns plain data out.

**Goes here**
- Balance, summary, statement, amortization, projection and budget calculations.
- Rules that decide what counts as income, expense, transfer or card payment.
- Anything that adds or compares money: use `shared/utils/money.ts` (2 decimals,
  one currency at a time; RD$ and US$ are never mixed or converted).

**Credit cards (2.8.0):** `cards.ts` (cortes, periodos, deuda, utilización, estados de cuenta, alertas), `card-payments.ts` (gasto que era pago de tarjeta) y `small-purchases.ts` (compras pequeñas, una sola regla para el mes y para una tarjeta).

**Income (2.9.0):** `income.ts` (fechas esperadas, promedios, estabilidad, garantizado vs variable, desglose mensual) y `benefits.ts` (beneficios no monetarios, aislado a propósito).

**Budgets (2.10.0):** `categories.ts` (naturaleza y árbol), `irregular.ts` (gasto irregular), `fixed.ts` (obligaciones), `budget.ts` (bloques, movimientos, riesgo, proyección, recomendaciones, tendencias).

**Dashboard (2.11.0):** `dashboard.ts` (desglose fijo/variable, flujo mensual, historial de ahorros, comparación de meses, dinero disponible, flujo de efectivo 30/60/90, gastos inusuales).

**Does not go here**
- Signals, `StorageService`, HTTP/sync, `TranslateService`, components.
- Formatting for display (pages and pipes do that).

**Rules**
- Every function has a vitest spec next to it covering zero, negatives,
  rounding, month end, leap years, USD vs DOP and empty lists.
- Anything that is a projection or inference returns an explicit estimate
  marker plus its assumptions; never present it as a confirmed figure.
- Services (signals) call these functions; components only display the result.
- Build test data with `shared/testing/builders.ts`.
