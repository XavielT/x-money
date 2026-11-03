# Reglas de integridad financiera

Mandan sobre cualquier comodidad de implementación. Si una regla choca con lo que pide un prompt, gana la regla y
se reporta. Estado a v2.5.2 (detalle y casos en `docs/AUDITORIA-2026-11.md`). Las pruebas están en
`src/shared/characterization/integrity.spec.ts` (casos C1–C9); las `KNOWN GAP:` documentan violaciones actuales.

## Las 10 reglas

### 1. Una transferencia entre cuentas propias no representa un ingreso ni un gasto.
- Dónde se aplica (archivo): `src/shared/services/transaction.service.ts` (`summarize`, `totalsByCategory`, `accountBalance`, `totalBalanceIn`).
- Prueba que la protege: C2 y C6 («a bank to card transfer is neither income nor expense…», «a transfer is one record…»).
- Estado: **cumple** (la comisión del movimiento sí es gasto, a propósito; ver C3).

### 2. Una compra con tarjeta de crédito se registra como gasto una sola vez.
- Dónde se aplica (archivo): `transaction.service.ts` (la compra es un gasto en la cuenta tarjeta).
- Prueba que la protege: C1 «a card purchase is one expense…».
- Estado: **cumple**.

### 3. El pago de una tarjeta de crédito no vuelve a contabilizar las compras.
- Dónde se aplica (archivo): solo por convención del usuario (registrarlo como transferencia); no existe tipo "pago de tarjeta".
- Prueba que la protege: C1 «paying the card as a transfer…» (conducta correcta) y `KNOWN GAP: paying the card as an expense counts the purchases twice`.
- Estado: **parcial** → prompt 02.

### 4. Los beneficios laborales no monetarios no se consideran efectivo disponible.
- Dónde se aplica (archivo): —
- Prueba que la protege: —
- Estado: no aplica todavía (N2 no existe) → prompt 03.

### 5. Las ventas comerciales deben distinguirse de las ganancias netas.
- Dónde se aplica (archivo): —
- Prueba que la protege: —
- Estado: no aplica todavía (N3 no existe) → prompt 06.

### 6. El inventario comercial debe mantenerse separado de los bienes personales.
- Dónde se aplica (archivo): —
- Prueba que la protege: —
- Estado: no aplica todavía → prompt 06.

### 7. Los ingresos variables no deben tratarse como ingresos recurrentes garantizados.
- Dónde se aplica (archivo): —  (hoy no hay distinción fijo/variable; las reglas recurrentes de ingreso en `recurring.service.ts` son el único "garantizado").
- Prueba que la protege: —
- Estado: no aplica todavía → prompt 03.

### 8. Los gastos ocasionales deben conservar su naturaleza variable.
- Dónde se aplica (archivo): —
- Prueba que la protege: —
- Estado: no aplica todavía (sin clasificación) → prompt 04.

### 9. Los saldos deben calcularse a partir de movimientos financieros consistentes.
- Dónde se aplica (archivo): `transaction.service.ts` (`accountBalance`, `totalBalanceIn`: saldo = inicial + movimientos).
- Prueba que la protege: C2, C6 (consistentes); `KNOWN GAP` en C4, C5, C6, C7, C9 (huérfanos, `NaN`, flotantes, importación, duplicados).
- Estado: **parcial** → prompts 00b y 01.

### 10. Las proyecciones deben identificarse claramente como estimaciones.
- Dónde se aplica (archivo): `insights.service.ts` (`subscriptionCost`), mostrado con «≈» en `stats.html:136-143` sin supuestos.
- Prueba que la protege: —
- Estado: **parcial** → prompts 05 y 09.

## Criterios antes de desarrollar cada función

1. Revisar la arquitectura y los módulos existentes.
2. Identificar entidades y relaciones reutilizables.
3. Evitar duplicar funcionalidad.
4. Mantener consistencia entre transacciones, cuentas y balances.
5. Diseñar componentes reutilizables.
6. Validar los cálculos con pruebas automatizadas.
7. Considerar operaciones parciales, reversos y correcciones.
8. Mantener trazabilidad de las operaciones.
9. Priorizar la integridad de los datos antes que las visualizaciones adicionales.
