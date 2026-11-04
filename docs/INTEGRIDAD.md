# Reglas de integridad financiera

Mandan sobre cualquier comodidad de implementación. Si una regla choca con lo que pide un prompt, gana la regla y
se reporta. Estado a v2.7.0 (detalle y casos en `docs/AUDITORIA-2026-11.md`). Las pruebas están en
`src/shared/characterization/integrity.spec.ts` (casos C1–C9, las `KNOWN GAP:` que siguen documentan violaciones que
poseen prompts posteriores), `src/shared/services/integrity-2-7.spec.ts` (prompt 01), `src/shared/domain/domain.spec.ts` y
`src/shared/data-layer/migrations.spec.ts`.

## Las 10 reglas

### 1. Una transferencia entre cuentas propias no representa un ingreso ni un gasto.
- Dónde se aplica (archivo): `src/shared/domain/stats.ts` (`summarize`, `totalsByCategory`, `isCounted`), `domain/ledger.ts` (las dos patas se anulan en el total), `domain/validation.ts` (mismo dueño o RD$↔US$ rechazados), `services/transaction.service.ts` (`convertToTransfer`).
- Prueba que la protege: `integrity-2-7.spec.ts` «transfers between own accounts (rule 1)» y «suggestions…»; C2 y C6 de caracterización; `domain.spec.ts` (stats, validation, transfers).
- Estado: **cumple.** Decisiones: (a) la comisión/impuesto DGII de una transferencia sigue siendo un gasto real aparte (categoría Bank fees) y se conserva el comportamiento y los números históricos; (b) una transferencia RD$↔US$ se **bloquea** (`cross-currency`) porque exige los dos montos y no existe esa opción (no se inventa una tasa); (c) las transferencias "no marcadas" (gasto en A + ingreso en B, ≤ 3 días, mismo monto salvo la comisión) solo se **sugieren**; el usuario las convierte, queda auditado y se puede deshacer.

### 2. Una compra con tarjeta de crédito se registra como gasto una sola vez.
- Dónde se aplica (archivo): `domain/stats.ts`; la compra es un gasto en la cuenta tarjeta y `domain/networth.ts` la muestra como deuda.
- Prueba que la protege: `integrity-2-7.spec.ts` «rules 2 and 3: credit cards»; C1; `credit-card.spec.ts` «rules 2 and 3» (compra 5.000 + pago 5.000: un gasto, banco −5.000, deuda 0; parcial, de más, dual US$, reversada, intereses) y `domain/cards.spec.ts` (consumo vs pagado).
- Estado: **cumple.** El consumo cuenta el día de la compra; los intereses y cargos que cobra el banco son un gasto real aparte (categoría «Card interest and charges»), registrado una sola vez y enlazado al estado de cuenta.

### 3. El pago de una tarjeta de crédito no vuelve a contabilizar las compras.
- Dónde se aplica (archivo): `services/transaction.service.ts` (`defaultOrigin`: una transferencia a una tarjeta de crédito es `card-payment`); el formulario avisa «¿Pagas una tarjeta? Usa Transferencia» cuando hay una tarjeta de crédito.
- Prueba que la protege: `integrity-2-7.spec.ts`; `credit-card.spec.ts` («rule 3 for payments that were typed as a plain expense», pago como liquidación, reverso de un pago); `domain/cards.spec.ts` (estados, pagado derivado) y la prueba de caracterización C1.
- Estado: **cumple, con una salvedad.** La pantalla «Pagar tarjeta» registra el pago como transferencia `card-payment` (baja la deuda y la cuenta pagadora, nunca es gasto) y lo aplica al estado de cuenta abierto más antiguo; qué se pagó se **deriva** de los pagos (revertir un pago devuelve el estado). Si el usuario lo registra igual como gasto, la app lo detecta (gasto en una cuenta que no es tarjeta, igual al balance, al mínimo o a lo pendiente de un estado de cuenta, después del corte y hasta 10 días tras el vencimiento) y **sugiere** convertirlo; nunca lo convierte sola, así que hasta que se confirme sigue duplicando.

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
- Dónde se aplica (archivo): `domain/income-patterns.ts` solo *sugiere* un patrón (≥ 3 depósitos, ±5 % de monto, cadencia semanal/quincenal/mensual ±3 días) y nada se etiqueta (`incomePattern`) sin confirmación; el prompt 03 lo enlaza a una fuente.
- Prueba que la protege: `domain.spec.ts` «detectRecurringIncomes» (nómina quincenal/mensual/semanal, un pago atrasado sí; irregulares, montos distintos, pocos o el mismo día NO) e `integrity-2-7.spec.ts` (confirmar/descartar)
- Estado: no aplica todavía → prompt 03.

### 8. Los gastos ocasionales deben conservar su naturaleza variable.
- Dónde se aplica (archivo): —
- Prueba que la protege: —
- Estado: no aplica todavía (sin clasificación) → prompt 04.

### 9. Los saldos deben calcularse a partir de movimientos financieros consistentes.
- Dónde se aplica (archivo): `domain/ledger.ts` (única fuente: saldo, saldo por moneda, saldo a una fecha, total), consumido por `TransactionService`/`NetWorthService`/`ReconciliationService`. Ningún saldo se guarda ni se sincroniza. Todo movimiento pasa por `domain/validation.ts` (monto > 0 y finito, fecha válida, cuenta existente y no archivada, moneda coherente) y por `utils/money.ts` (redondeo a 2 decimales).
- Prueba que la protege: `integrity-2-7.spec.ts` «ledger invariants over random sequences» (semillas fijas: tras agregar/editar/reversar/transferir/borrar, cada saldo = lo recalculado en centavos y la suma de saldos varía exactamente en ingresos − gastos − comisiones), «the ledger gives the same numbers as the formulas of 2.5.1», `sync.spec.ts` (mismos saldos en dos dispositivos), `data-layer.spec.ts` y `migrations.spec.ts` (sin regresión con fixtures 2.5.1), reversos/correcciones/conciliación en `integrity-2-7.spec.ts`.
- Estado: **cumple** en lo nuevo. Decisiones: (a) un **reverso** agrega el movimiento inverso y marca el par `reversed` (los saldos conservan ambos y se anulan; estadísticas y presupuestos los saltan); la comisión que el banco ya cobró **no se devuelve** (sigue como gasto); (b) las cuentas con movimientos se **archivan**, no se borran; (c) los movimientos huérfanos de cuentas borradas antes de la 2.7.0 siguen sumando en el total (`orphan` del ledger) para no cambiar números históricos, y Cuentas avisa de cuántos son; (d) el `KNOWN GAP` de una tarjeta de débito cuyo banco se borra por el servicio sigue documentado (la pantalla ya no permite borrar cuentas con movimientos).

### 10. Las proyecciones deben identificarse claramente como estimaciones.
- Dónde se aplica (archivo): `insights.service.ts` (`subscriptionCost`), mostrado con «≈» en `stats.html:136-143` sin supuestos.
- Prueba que la protege: —
- Estado: **parcial** → prompts 05 y 09. (La 2.7.0 no agrega proyecciones: la conciliación y el patrimonio muestran solo datos calculados; la detección de ingresos recurrentes es una *sugerencia* con su cadencia y cantidad de depósitos visibles, no una proyección.)

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
