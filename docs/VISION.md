# Visión de la ronda de noviembre 2026

X Money pasa de ser un registro de ingresos y gastos a una plataforma de gestión financiera personal, con los datos
en la cuenta de Xaviel (Supabase `x-core`) y copia local en cada dispositivo.

## Resultado esperado

X Money debe permitir que una persona comprenda no solamente cuánto dinero tiene, sino de dónde viene, en qué lo
utiliza, cuánto de ese dinero realmente le pertenece como beneficio neto, cuánto está comprometido y cuánto puede
destinar a nuevos objetivos sin poner en riesgo su estabilidad financiera.

Para llegar ahí: múltiples fuentes de ingreso, beneficios laborales no monetarios, negocios paralelos con
inventario, gastos fijos/variables/irregulares, tarjetas de crédito con estados de cuenta, cuentas y conciliación,
presupuestos sobre ingresos reales, simulador de préstamos, objetivos y fondo de emergencia, dashboard,
inteligencia determinística y, al final, IA transversal (ver `docs/IA.md`).

## Prioridades

| Nivel | Tema | Contenido |
|---|---|---|
| **P0** | Integridad | transacciones, cuentas, transferencias internas, tarjetas de crédito, ingresos y gastos |
| **P1** | Control | presupuestos, categorías, gastos recurrentes y variables, dashboard |
| **P2** | Negocios | inventario, capital de trabajo, ventas, rentabilidad |
| **P3** | Planificación | ahorros, objetivos, préstamos, simuladores de amortización |
| **P4** | Inteligencia | patrones, proyecciones, recomendaciones, alertas inteligentes |

Regla de oro: **integridad de datos antes que visualizaciones** (`docs/INTEGRIDAD.md`). Es una app personal con
datos reales: un bug que corrompa o pierda datos es peor que cualquier función que falte.
