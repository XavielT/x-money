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

**Loans (2.14.0):** `loans.ts` (tasas TNA/TEA/plana, periodicidad, tabla de amortización por método, costos y costo efectivo por TIR, cuadrícula monto × plazo, comparación de ofertas, abonos extra, cancelación anticipada y cambios de tasa), `loan-ops.ts` (saldo derivado, reparto interés → cargos → capital, recálculo tras un abono extra, alertas 7/3/1 días y vencida) y `borrowing.ts` (niveles de ingreso, tres lecturas, umbrales de referencia, caída de ingresos).

**Goals (2.13.0):** `goals.ts` (reservado, progreso con excedente visible, recordatorios del plan, proyección con dos escenarios y «historial insuficiente», viabilidad contra el margen mensual, fondo de emergencia de N meses con aviso de cambio de meta, totales personal/comercial, validación).

**Business (2.12.0):** `business.ts` (costo por unidad, ventas y beneficio, inventario, pool de capital, rentabilidad mensual, inventario lento, validación).

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
