# UX — ronda de interfaz del 09/11/2026

Esta ronda (2.21.0 en adelante) no cambia cálculos, reglas de integridad ni datos guardados: cambia **dónde** está cada cosa y
**cuántos toques** cuesta. Ocultar una función no es borrarla.

## Principios
1. Una cifra principal por pantalla.
2. Lo común, a pocos toques; lo avanzado, detrás de «Más opciones».
3. Nada de datos crudos para el usuario (ids, claves, jerga contable).
4. Nada tapado por botones flotantes ni por la barra inferior (altura de la barra + safe area).
5. **Editar siempre en el sitio del elemento**: el formulario aparece justo debajo de lo que se edita, uno a la vez.
6. 360 px de ancho primero: sin scroll horizontal de la página, objetivos táctiles de 44 px.

## Tabla de toques (desde Inicio, ruta más corta; no cuentan los toques del teclado ni escribir)
| Flujo | Objetivo | Medido |
|---|---|---|
| Registrar un gasto | 3 (+, categoría, Guardar) | prompt 16 |
| Registrar un ingreso | 4 | prompt 16 |
| Transferir entre mis cuentas | 4 | prompt 16 |
| Pagar una tarjeta | 5 | prompt 16 |
| Editar una cuenta | 2 (Cuentas, Editar; el formulario sale bajo ella) | prompt 16 |
| Aprobar un borrador de captura | 3 | prompt 16 |
| Ver cuánto tengo disponible | 0 (lo primero de Inicio) | prompt 16 |
| Crear un presupuesto | 3 | prompt 16 |
| Cambiar el idioma | 3 (Ajustes, Preferencias, idioma) | prompt 16 |
| Hacer un respaldo | 3 | prompt 16 |

Un cambio que sume toques a un flujo de esta tabla no se hace.

## Patrones de interfaz
- **Editar en su sitio** (2.21.0): `src/shared/ui/reveal.ts` → `revealAndFocus(host, selector)`. El formulario es un `ng-template`
  pintado con `ngTemplateOutlet` en un solo sitio a la vez: como hermano siguiente de la fila editada. Crear = botón arriba de la
  lista y el formulario justo debajo. Ya aplicado en Cuentas, Categorías y Beneficios; la Revisión de capturas ya lo hacía.
- Secciones con filas de resumen — pendiente (prompt 15).
- Módulos que se activan — pendiente (prompt 14/15).
- Captura (2.21.0): sin botón flotante. Cámara en el encabezado de Inicio con insignia, tarjeta «N capturas esperan» en Inicio, y
  una fila «¿Tienes una captura…?» en Nuevo movimiento. Rutas `/capture` y `/capture/review` sin cambios.

## Lenguaje por revisar (lo resuelve el prompt 14)
- Préstamos (simulador): «Fixed installment (french)», «Constant principal (german)», TNA/TEA, «Capitalizations per year», «Amortization table», «Prudence discount».
- Tarjeta: «Statement balance», «Utilization», «Cut rule», «Recalculate», «Interest, fees and advances»; Pagar tarjeta: «Statement balance», «Minimum payment».
- Negocio: «Capital recovered», «Working capital», «Gross profit», «ROI» (literal fuera de `t`), «Cost per unit (constant)».
- Conciliar / detalle de cuenta: «Reconcile» (el prompt 14 lo pasa a «Match with the bank»), «Create an adjustment».
- Presupuesto: «Base income», «Guaranteed», «median», «Straight-line trend».
- Ingresos: «Verifiability», «Documented/Declared», «Expected gross».
- Metas: «Viability», «Margin = guaranteed income − …».
- IA: JSON crudo (`<pre>`) en el paso de consentimiento; confianza como porcentaje.
- Captura (revisión): `d.source` (mail, image) y `d.sender` crudos en el historial.
- Análisis: meses como `YYYY-MM` y «Δ» fijo; Estadísticas: «Ant expenses».
- Gastos fijos: «averaged to a month (4.35 weeks, 30.44 days)».

## Revisión por código de pantallas no vistas en el teléfono (09/11/2026)
Hecha leyendo plantillas y estilos (un agente de solo lectura, verificada por mí donde se aplicó); nada de esto se vio en pantalla.
- **Aplicado aquí (misma causa que los bloques 2 a 5):** grids con `1fr` sin `minmax(0, 1fr)` y filas flex sin `min-width: 0` en Estadísticas, Revisión de capturas, Simulador de préstamos, Presupuestos, Gastos fijos, Inicio, Ingresos, Ajustes, Cuentas y Categorías; formulario de Beneficios (que reemplazaba la lista) ahora en su sitio.
- Contenido bajo la barra inferior: sin hallazgos (todas usan `.x-page`, 96 px + safe area; ningún elemento fijo al pie salvo la hoja de indicadores, con z-index sobre la barra).
- Formularios que ya estaban en su sitio: Ingresos, Negocio (vistas aparte), Tarjeta, Simulador (registro en línea), Préstamos (pago en línea), Revisión de capturas.

## Cola de mejoras (A alta / M media / B baja)
| Pri | Pantalla | Qué | Por qué |
|---|---|---|---|
| A | Simulador de préstamos | Elegir «french/german» sin explicación; página de ~280 líneas | Jerga y largo; es la pantalla más densa (prompt 14) |
| M | Metas | El formulario de edición sale arriba de la lista y «Editar» está al fondo de cada meta expandida | Mismo problema que Cuentas; no se aplicó aquí porque el prompt lo daba por correcto y hay que verlo en pantalla |
| M | Negocio | «Buy an article» al final de la lista de operaciones | Para comprar hay que pasar toda la lista |
| M | Análisis / Plan de presupuesto | Tablas de 4 y 6 columnas sin contenedor con scroll | Riesgo de desbordar en 360 px con montos grandes |
| M | Pagar tarjeta | Tres botones de elección con dos líneas y poco alto | Objetivo táctil menor de 44 px en una acción principal |
| M | Detalle de cuenta | «Add transaction» sin la cuenta preseleccionada (no verificado en el .ts) | Toques de más |
| M | Gastos fijos | Sin botón para agregar/editar; manda a Ajustes | Desvío; estado vacío sin siguiente paso |
| M | Conciliar | «open History» sin enlace; título con jerga | Siguiente paso poco claro |
| M | Insights / IA / Tarjeta | Enlaces y chips de 3 a 8 px de alto vertical | Objetivos táctiles menores de 44 px |
| M | Varias | Botón «←» sin relleno (<44 px) y pantallas sin botón atrás (Insights, IA, Préstamos, Metas, Estadísticas) | Navegación |
| M | Cuentas / Categorías | Botones «Editar», «Conciliar» y ✎ ✕ de 6 px de relleno | Objetivos táctiles menores de 44 px (no se tocó: cambia el diseño de la fila) |
| B | Ingresos | Fila de la tabla de revisión y select de 120 px mínimo | Apretado en 360 px |
| B | Estados vacíos | Estadísticas, Detalle de cuenta, Tarjeta (estados de cuenta), IA, Insights sin siguiente paso | Solo texto |
| B | Bundle inicial | 608,12 kB sobre el presupuesto de 600 kB (606,12 kB en 2.20.7; este bloque sumó ~2 kB) | Advertencia que ya existía |
