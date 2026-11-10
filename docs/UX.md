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
- **Ajustes como menú** (2.23.0): `/settings` es una lista de filas de 60 px con icono, título y una línea de estado (`menuStatus`); cada fila
  abre `/settings/<id>` con carga perezosa, cabecera con «‹» (≥44 px) y título (`app-settings-header`). Los ids son las claves de
  `SETTINGS_LINKS`; `/settings#<id>` redirige. Reglas de las pantallas: opciones excluyentes de 2–4 valores = control segmentado;
  5 o más = `select`; lo avanzado y poco usado = un solo `<details class="settings-advanced">` cerrado por pantalla; lo destructivo =
  bloque «Danger zone» al final de «Tus datos», con la confirmación que ya tenía. Cada control guarda al instante y en el mismo
  almacén de antes. Una pantalla nueva = una entrada en `SETTINGS_SECTIONS` y su ruta (el compilador la exige).
- **Mapa de Ajustes** (2.23.0): dónde quedó cada control de la página larga.

| Control de antes | Pantalla |
|---|---|
| Módulos («Features») | features |
| Inteligencia artificial, Captura inteligente (interruptores y consentimientos) | features |
| Idioma | preferences (control segmentado) |
| Símbolo de moneda principal | preferences (selector) |
| Impuesto de transferencia bancaria (%) | preferences |
| Enlace «Manage accounts» (a /accounts) | preferences (no encajaba en ninguna; es la pantalla más parecida) |
| Gestor de categorías | categories |
| Movimientos recurrentes (pausar, editar, borrar) | recurring |
| Alertas de tarjeta (corte y vencimiento) | alerts |
| Alertas inteligentes (reglas y umbrales) | alerts |
| Umbral de aviso de presupuesto, «compras pequeñas» | alerts → Avanzado |
| Estado de sync, «Sync now», hora cuadrada, cambios pendientes | data (tarjeta de estado) |
| Último respaldo, «Remind me every», aplazamiento | data (tarjeta de estado) |
| Exportar respaldo (JSON) | data → «Back up now» en la tarjeta de estado (mismo archivo) |
| Exportar CSV | data |
| Versiones en conflicto | data |
| Historial de cambios | data → plegable «Change history» |
| Importar respaldo | data → Avanzado |
| Borrar todos los datos / Quitar datos de este dispositivo | data → Danger zone |
| Cuenta (correo, dispositivos, contraseña, código de recuperación, invitar, cerrar sesión) | account (contraseña, código e invitar bajo Avanzado) |
| Aviso para instalar en iPhone | account |
| Bloqueo con PIN | security (existe, así que la fila se muestra) |
| Versión y «Check for updates» | about |

- **Respaldo confirmado** (2.23.1): en el teléfono la hoja de compartir no dice si el archivo llegó a algún sitio, así que «Back up now» pregunta «¿Guardaste o enviaste el archivo?» y solo con «Sí» reinicia el contador del aviso (`BackupService.markSaved`). Cerrar la hoja sin elegir no registra nada; las copias de seguridad previas a importar o cerrar sesión nunca tocan el aviso; en el navegador la descarga cuenta al momento.
- **Historial legible** (2.23.0): `describeChange` (puro) convierte cada tipo de evento en una frase («Expense of RD$350.00 added in Food»); el
  JSON queda dentro de «Show details». Un tipo desconocido dice «Change in <entidad>». Cada importe lleva el símbolo de su moneda (US$ o el
  de pesos), nunca mezclados.
- **Módulos que se activan** (2.22.0): núcleo siempre activo (cuentas y tarjetas, movimientos, presupuestos y gastos fijos, estadísticas,
  Ajustes) y seis módulos con interruptor (Ingresos, Beneficios, Negocio, Préstamos, Objetivos, Alertas inteligentes). Sin elección
  explícita el módulo es automático (encendido si tiene datos; Alertas inteligentes nace encendido). Interruptores en Ajustes →
  «Features» (`app-module-switches`). Una página de un módulo apagado abre igual y muestra «This feature is off. Turn it on».
  **Regla de integridad:** apagar un módulo solo oculta accesos, tarjetas de Inicio e indicadores; nunca borra datos ni deja de contarlos
  (la deuda de un préstamo sigue restando del patrimonio, los pagos siguen en los presupuestos). Los avisos de pagos (tarjetas y
  préstamos) y los recordatorios de metas se muestran siempre: son obligaciones. Un indicador del tablero se oculta (nunca en cero) solo
  si todas sus fuentes son módulos apagados.
- **Una cifra principal por pantalla** (2.22.0): Inicio = «Available money» y debajo «Money in your accounts»; la tarjeta que era «Total
  balance» es «This month». Cuentas = «Money in your accounts», «After paying your cards» (= suma de saldos) y, solo si debes en
  préstamos, «After your loans». Las dos cifras salen de la misma señal (`NetWorthService`).
- **Cifra al día** (2.22.0): ficha «Updating…» bajo la cifra principal (reserva su espacio) mientras se sincroniza o lee el correo, y
  «Offline: showing the last saved data» con la hora si no hay conexión.
- **Respaldo** (2.22.0): el aviso vive solo en Inicio; «Later» lo calla 7 días (`device-prefs.backupSnoozedUntil`).
- **Guía inicial** (2.22.0): tarjeta «Get started» de 3 pasos que se marcan solos; no la ven usuarios con cuentas y movimientos.
- Captura (2.21.0): sin botón flotante. Cámara en el encabezado de Inicio con insignia, tarjeta «N capturas esperan» en Inicio, y
  una fila «¿Tienes una captura…?» en Nuevo movimiento. Rutas `/capture` y `/capture/review` sin cambios.

## Lenguaje por revisar (el prompt 14 resolvió el glosario de `docs/LENGUAJE.md`; lo que sigue queda)
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
| M | Ajustes | Buscador de ajustes arriba del menú (opcional, no se hizo en 2.23.0) | Con 9 filas todavía no hace falta; revisar si crecen |
| M | Ajustes → Datos | La confirmación de «Delete all data» es un solo `confirm()`; podría pedir escribir la palabra | No se debilitó ni se cambió |
| B | Bundle inicial | 625,43 kB sobre el presupuesto de 600 kB (624,59 kB en 2.22.0, 608,12 kB en 2.21.0; 2.23.0 sumó ~0,8 kB: rutas y dominio del menú) | Advertencia que ya existía |
