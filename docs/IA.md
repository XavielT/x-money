# Directriz de IA (contrato)

Aún no hay código de IA. Este documento es el contrato que deben respetar los prompts 10 y 11.

## Principios
- La IA es una capacidad **transversal**, no un chatbot ni una sección aparte: analiza, automatiza tareas, detecta
  patrones, genera recomendaciones y facilita decisiones en todos los módulos donde aporte valor real.
- No se implementa IA por agregarla: cada integración debe resolver un problema concreto, mejorar la experiencia o
  dar información difícil de obtener de otra forma.
- **Determinismo:** las operaciones financieras y los cálculos críticos son lógica determinística (`shared/domain`);
  la IA asiste, no inventa ni modifica cifras.

## Arquitectura
- Modular y sin acoplarse a un proveedor o modelo.
- Una capa única y reutilizable para llamar a modelos; cambiar de proveedor/modelo sin tocar cada módulo.
- Control de tokens, solicitudes y costos; manejo de errores, límites y tiempos de espera.

## Privacidad
- Los datos financieros del usuario solo se usan cuando son necesarios y con controles.
- Aunque los datos viven en `x-core`, la IA **no lee la base**: la app calcula y manda solo lo necesario.
- Decisión de Xaviel (03/11/2026): solo agregados y con opt-in; para categorizar un gasto sale únicamente el texto de
  esa nota; todo se activa en Ajustes y se puede apagar.

## Credenciales y backend
- Ninguna API key en el frontend, el repo, código público ni variables accesibles al cliente; solo variables de
  entorno de un backend que controle las solicitudes. Se evalúa aislamiento de credenciales, permisos, límites de
  consumo y costos por proyecto.
- Backend decidido por Xaviel (03/11/2026): proyecto de Supabase **`x-core`** (su cuenta personal, donde vive el
  backend de sus apps propias), con cuentas propias de X Money (no Supabase Auth). No se usa ni se enlaza el
  Supabase de SGC ni de csd-app (son del trabajo).
- API key de Anthropic: Xaviel tiene autorización para reutilizar la misma key que usan SGC y csd-app (decisión del
  03/11/2026). La reutilización es de la **credencial**, no de los proyectos: la key se guarda como secreto de la
  función de `x-core`, copiada por Xaviel a mano; nunca pasa por el repo, el cliente, el chat ni los archivos `.env`
  que Claude Code pueda leer. Como el costo cae en la cuenta del trabajo, la función registra el uso de X Money por
  separado (tabla `xmoney.ai_usage`) y aplica topes propios, para medir y limitar cuánto consume la app personal.
- La service role key de Supabase jamás entra a la app.

## Base determinística (2.15.0)

La IA de los prompts 10 y 11 **narra y explica** lo que `shared/domain/insights/` ya calculó: cada `Insight` trae su evidencia (cifras con periodo e ids de movimientos), su fórmula, su estado de dato (`confirmed` / `estimate`) y su huella. Los candidatos a duplicados (`SmartInsightService.duplicateCandidates`) también alimentan la IA. La IA no calcula ni modifica ninguna cifra; todo lo que proyecta es `Estimate<T>` con sus supuestos.

## Infraestructura (2.16.0)

- **Servidor:** `supabase/functions/xmoney-ai/`. Mismas cuentas y sesiones que `xmoney-api` (`lib/authn.ts` reutiliza `verifyAccessToken` y las búsquedas de sesión y cuenta), exige `ai_enabled` y despliega sin verificación JWT de Supabase. Tabla `xmoney.ai_usage`: cuenta, función, modelo, tokens, costo estimado, estado y latencia; **nunca el contenido**.
- **Contrato:** `run { feature, input, locale, requestId }` → `{ ok, output, usage, model, requestId }`; `usage {}` → uso del mes de la propia cuenta. Errores: `unauthorized | quota | rate_limited | timeout | provider_error | bad_request`.
- **Lista blanca (`lib/features.ts`):** el cliente nombra una función; las instrucciones, el nivel de modelo, el tope de tokens y la validación de entrada son del servidor. Hoy solo existe `ping`; el prompt 11 agrega las de cada módulo. Reglas comunes: el modelo escribe texto con marcadores y **nunca cifras**.
- **Proveedor desacoplado (`lib/provider.ts`):** interfaz `Provider`; hoy `lib/anthropic.ts`. Para agregar otro: escribir su implementación, nombrarlo en `providerFor()` de `index.ts` y poner su nombre en el secreto `XMONEY_AI_PROVIDER`. Los modelos salen de `XMONEY_MODEL_FAST` y `XMONEY_MODEL_SMART`; no están en la app. Precios: `lib/pricing.ts` está vacío a propósito (verificar contra la página oficial; sin precio, costo `null`).
- **Cliente (`src/shared/ai/`):** `AiService` (registro de funciones, estado, caché con TTL por huella, deduplicación, tope diario de 30 solicitudes por dispositivo, avisos al 80 % y bloqueo al 100 %), `XMoneyAiGateway` (reutiliza `XMoneyApiClient` y su sesión; sin supabase-js), `minimizer.ts` (solo agregados; el texto de una nota es la única excepción), `output.ts` (marcadores, validación y sustitución).
- **Privacidad:** apagada por defecto, interruptores general y por módulo (apagados), explicación con vista previa exacta en el primer uso de cada función, «Ver qué se envía» y «Borrar caché de IA» en Ajustes. Hay un segundo interruptor reservado y deshabilitado para la captura de documentos del prompt 12. Consentimiento y caché son **solo del dispositivo**.
- **Patrones aprendidos (solo leídos, no copiados):** de `CompaService` de csd-app: el cliente nunca lanza hacia la pantalla, convierte cada fallo en un resultado tipificado (sin conexión, servicio, sin configurar) y la interfaz muestra un mensaje amable; solo ONLINE y sin cola. **Lo que no se reutiliza:** su dependencia de supabase-js y de la verificación JWT de Supabase (X Money tiene cuentas propias), sus herramientas con acceso a datos (aquí la función **no lee la base**) y el chat. De SGC (`supabase/functions/_shared` y `assistant`) **no pude leer nada**: ese repo no está en esta máquina, así que no se tomó ningún patrón de ahí; lo de proveedor, tiempo de espera, reintento y registro de uso es diseño propio de este prompt.

## Funciones de IA (2.17.0)

Treinta funciones en ocho módulos (`src/shared/ai/catalog.ts`, lista blanca del servidor en `supabase/functions/xmoney-ai/lib/features-modules.ts`). Todas siguen el mismo diseño: se muestra primero el texto **calculado**; la IA solo agrega lenguaje con marcadores (las cifras las pone el dispositivo), clasifica, agrupa o reordena; el resultado es una sugerencia que el usuario acepta; con la IA apagada, sin conexión o con texto rechazado por el validador, se queda el texto calculado. La columna «Decisión» dice con honestidad cuáles aportan poco: se implementaron en su versión ligera y no se omitieron.

| Función | Problema que resuelve | Alternativa determinística | Decisión y criterio | Cómo saber si sirve |
|---|---|---|---|---|
| `income-classify` | Clasificar ingresos sueltos por su nota («quincena», «venta pantalla») | Reglas locales aprendidas + asignar a mano en Ingresos | **Útil**: ahorra el trabajo repetitivo; solo sugiere y solo liga a una fuente que ya existe | Cuántas sugerencias aceptas sin cambiarlas (si <60 %, apágala) |
| `income-pattern-explain` | Dice con palabras qué cadencia detectó el sistema | La tarjeta del patrón detectado ya muestra fechas y monto | **Aporta poco**: versión ligera; solo redacción | Si la abres más de 2 veces al mes |
| `income-unusual-question` | Redacta la pregunta al usuario sobre un ingreso mayor de lo usual | La misma pregunta fija con las cifras | **Aporta poco**: ligera | Si respondes la pregunta (clasificas el ingreso) después de verla |
| `income-sources-summary` | Resume concentración y estabilidad de las fuentes | Los números de Ingresos y el indicador de dependencia | Media: redacta lo que ya está calculado | Si dejas de abrir la pantalla de análisis |
| `expense-categorize` | Categorizar una nota nueva o los gastos sin categoría, en lote y agrupando iguales | Reglas locales + elegir la categoría a mano | **Útil**: es donde la IA da más valor; la regla aprendida evita preguntar dos veces | % de sugerencias aceptadas y llamadas por regla vs por IA |
| `expense-recurring-normalize` | Limpiar notas bancarias («NETFLIX.COM 805 CA» → «Netflix») para nombrar gastos recurrentes | Mostrar la nota tal cual | **Útil**: difícil de hacer bien sin lenguaje; solo viajan los textos distintos | Si los nombres propuestos te sirven sin editar |
| `expense-atypical-explain` | Describe los gastos atípicos marcados por el detector | La lista de atípicos con cifras | **Aporta poco**: ligera | Si cambias algún gasto tras verla |
| `expense-savings-tips` | Dos o tres acciones priorizadas para gastar menos | La lista de categorías con su cambio | Media: lo valioso es la priorización | Si aplicas alguna acción (bajas un presupuesto) |
| `budget-behavior` | Resumen del mes frente al presupuesto | Barras de presupuestos | **Aporta poco**: las barras ya lo dicen | Si lo lees en vez de las barras |
| `budget-risk-alert` | Aviso con una sugerencia accionable cuando un presupuesto corre riesgo | La alerta de riesgo del prompt 04 | Media | Si ajustas el presupuesto después del aviso |
| `budget-strategy-pick` | Elegir entre las 3 estrategias ya calculadas y explicar por qué | La regla determinística elige (conservadora si lo garantizado es mucho menor) | Media: la elección es casi mecánica | Si la elección coincide con la calculada y la sigues |
| `business-profitability` | Resumen de márgenes, retorno y rotación | Cifras de la pantalla de Negocios | **Aporta poco** | Si la abres |
| `business-grouping` | Agrupar nombres de artículos que son lo mismo («pantalla civic 2016» = «display Civic 16») | Ranking por nombre exacto | **Útil**: sin agrupar el ranking de más vendidos es engañoso; el usuario confirma cada grupo | % de grupos confirmados |
| `business-margin-explain` | Qué explica el margen y qué operaciones lo tienen bajo | Tabla de ventas con margen | Media | Si corriges el precio o el costo tras verla |
| `business-capital-eval` | Narrativa de capital inmovilizado, inventario lento y concentración | Indicadores de Negocios | **Aporta poco** | Si vendes inventario lento después |
| `account-movements` | Resumen de movimientos por tipo de cuenta | Totales por cuenta | **Aporta poco**: por tipo, nunca por nombre | Si la abres |
| `duplicate-judge` | Decidir si un par dudoso es duplicado leyendo solo las dos notas y un rango | Candidatos con puntaje del prompt 09 | **Útil** para los dudosos; nunca fusiona ni borra | Concordancia con tu decisión |
| `card-habits` | Días y categorías donde más se consume con tarjeta | Totales por día de la semana | **Aporta poco** | Si cambias hábitos |
| `commitments-priority` | Qué pagar primero y por qué | Lista de compromisos por fecha | Media: el orden ya sale por fecha | Si evitas un pago tardío |
| `loan-scenarios` | Explicar diferencias entre plazos | La tabla de plazos del simulador | Media | Si cambias el plazo tras leerla |
| `loan-capacity` | Explicar las tres lecturas de capacidad (sin beneficios no monetarios) | La tarjeta de capacidad | Media | Si la comprensión de las lecturas mejora |
| `loan-installments` | Cómo se reparte el total entre capital, intereses y cargos | Totales del simulador | Media | Si pruebas abonos tras leerla |
| `loan-advice` | Consejo cauteloso sobre la simulación (sin garantizar ni recomendar institución) | Comparación de plazos | **Aporta poco**: ligera; siempre rotulada como simulación | Si lo usas para decidir |
| `goal-projection` | Explicar cuándo se logran los objetivos | Proyección del prompt 07 con sus supuestos | **Aporta poco** | Si la lees |
| `savings-split` | Cómo repartir lo reservable entre objetivos por urgencia | Lista de objetivos por fecha | Media | Si sigues el reparto |
| `goal-viability` | Explicar si cada meta es alcanzable con el margen | Viabilidad calculada | **Aporta poco** | Si ajustas metas |
| `dashboard-summary` | Párrafo semanal / mensual de lo más importante | Los 10 indicadores | Media | Si lo abres cada semana |
| `dashboard-indicators-rank` | Ordenar qué indicadores merecen atención | Orden por tamaño del cambio | **Aporta poco**: ligera, solo reordena | Si el orden de la IA difiere del calculado y te sirve más |
| `dashboard-alerts` | Presentar las alertas activas en orden y lenguaje claro | El centro de alertas ya las ordena | **Aporta poco**: ligera | Si la lees en vez del centro de alertas |
| `dashboard-explain` | «Explícame» por qué cambió un indicador | Los componentes de «¿Cómo se calculó?» | Media | Si pulsas «Explícame» más de una vez por semana |

**Balance honesto:** donde la IA aporta valor real es en el texto libre (categorizar notas, normalizar nombres, agrupar artículos, juzgar duplicados dudosos). Las narraciones (la mayoría) solo redactan cifras que ya están en pantalla: su utilidad es de comodidad y se mide con el uso; si pasados dos meses casi no las abres, apágalas por módulo en Ajustes.

## La IA se activa por cuenta, con el interruptor del usuario (2.18.2)

El indicador `ai_enabled` de la cuenta ya no lo pone un operador en la base: al encender **Usar inteligencia
artificial** o **Captura inteligente** en Ajustes, la app lo enciende en el servidor (acciones `enable`/`disable` de
`xmoney-ai`, solo sobre la **propia** cuenta autenticada), y una llamada que encuentre la cuenta sin activar lo hace
una vez y reintenta. El operador sigue pudiendo bloquear una cuenta entera (`enabled = false`) y los topes siguen
iguales. Pruebas: `server-tests/ai-enable.spec.ts` y `shared/ai/ai-enable.spec.ts`.

## Captura inteligente (2.18.0): la excepción a «solo agregados»

La directriz de 2.16.0 es que a la IA solo salen agregados. **La captura no puede cumplirla**: para leer una
captura hay que enviar el documento mismo. Es la **única excepción**, explícita y controlada:

- Interruptor propio «Captura inteligente», **apagado por defecto**, separado del general y de los de módulo; al
  encenderlo, consentimiento que dice qué sale (la imagen/PDF/texto de cada captura, hacia `x-core` y de ahí al
  proveedor) y qué no (nada más de tu base). Se registra la fecha y se retira apagándolo.
- Cada captura muestra antes de enviar lo que viajará (con herramienta de recuadros negros) y un botón «Enviar para
  leer»; «no volver a preguntar» solo oculta la vista previa.
- Minimización local: imágenes a 1600 px máximo, recomprimidas y sin metadatos; PDF de máximo 5 MB y 10 páginas;
  texto sin firmas, pies legales ni números largos (se conserva la referencia de la transacción).
- El servidor (`capture_parse` en la lista blanca de `xmoney-ai`) no guarda el documento ni el texto, no los escribe
  en registros y no los reenvía; guarda solo metadatos de uso. El tipo se decide por los **bytes**, no por el nombre.
- El archivo original se borra al aprobar o rechazar; «Guardar comprobante» (apagado) conserva una miniatura local;
  los comprobantes **no** se sincronizan.
- Topes: los del 10 más **40 capturas por día** (servidor y dispositivo) y un tope mensual de costo estimado.

### Retención de datos de Anthropic (verificado el 04/11/2026)
Según el Centro de privacidad de Anthropic (privacy.claude.com, «How long do you store my organization's data?»), las
entradas y salidas de la API se eliminan del backend de Anthropic **dentro de los 30 días** de recibirse o generarse,
salvo excepciones: acuerdos de retención cero, servicios con retención bajo tu control (p. ej. Files API),
violaciones de la política de uso señaladas por sistemas automáticos (hasta 2 años; puntuaciones de clasificación
hasta 7), comentarios enviados por el usuario (5 años) y lo que exija la ley. **No afirmo nada sobre entrenamiento**:
esa página no lo dice; si necesitas esa garantía, revisa los términos comerciales vigentes o pide retención cero.
Para el correo y la voz en navegador, ver `CAPTURA.md` (el reconocimiento de voz del navegador lo hace el fabricante).

### Funciones de captura

(2.19.0: `capture_parse` también lee capturas de cuentas bancarias y tarjetas y propone la cuenta nueva con su saldo como
apertura; ver `docs/CAPTURA.md`. El modelo no recibe ni devuelve el número completo ni el nombre del titular.)


| Función | Problema que resuelve | Alternativa determinística | Decisión y criterio | Cómo saber si sirve |
|---|---|---|---|---|
| `capture_parse` · imagen/PDF (`captura_imagen_pdf`) | Registrar un consumo, depósito o factura desde una captura sin teclear | El formulario manual de movimientos | **Útil, con consentimiento propio**: lee y propone; tú apruebas (regla 11) | Qué % de borradores apruebas sin editar el monto (si <70 %, no vale la pena) |
| `capture_parse` · texto/voz (`captura_texto_voz`) | Dictar o pegar «gasté 1.500 en el colmado» y que quede el borrador | **Lectura local sin IA** (`domain/capture/local.ts`: monto, verbo, cuentas por palabras) y el formulario | **Útil**; sin IA igual funciona en versión ligera | Cuántas frases salen sin campos vacíos |
| `capture_parse` · correo (`captura_correo`) | Encontrar solos los avisos de consumo y depósitos de tus bancos | Captura manual por imagen/texto pegado | **Opcional, apagada por defecto**: requiere Google Cloud y reconectar cada 7 días en modo Testing | Avisos leídos vs. borradores aprobados |

La salida es siempre un JSON de forma fija (validado en el servidor y otra vez en el dispositivo); los montos llegan
como el texto del documento y los convierte el código; el modelo no tiene herramientas ni ejecuta nada.

## Guion de humo con la IA real (2.17.0)

Las pruebas automáticas NO llaman al proveedor. Con la función `xmoney-ai` desplegada y `ai_enabled` activo en tu cuenta (docs/SETUP-XCORE.md), en el teléfono o la web:

1. **Ajustes → Inteligencia artificial:** enciende el interruptor general y todos los módulos; «Probar conexión» debe decir «La conexión funciona». Anota el uso del mes.
2. **Ingresos:** `/ai` → Ingresos. «Revisar ingresos sin fuente» → «Sugerir con IA» (confirma primero lo que se envía) → acepta una: solo debe ligarse a una fuente que ya exista. Revisa que «Ingreso inusual» haga una pregunta sin inventar la causa.
3. **Gastos:** crea un gasto con la nota «uber casa» sin categoría; en el formulario aparece «Sugerir una categoría con IA»; acepta una y repite con otra nota con la misma palabra: ahora debe salir «aprendida» sin llamada. En `/ai` → Gastos → «Revisar gastos sin categoría» agrupa notas iguales. «Normalizar» debe devolver nombres cortos.
4. **Presupuestos:** «Cómo va el mes» y «Alerta de riesgo» muestran su texto calculado y, con IA, una versión escrita con las **mismas** cifras. «Qué estrategia te encaja» elige una de las tres.
5. **Negocios:** «Agrupar con IA» propone familias; confirma una y mira que «Más vendidos» se calcule sobre el grupo.
6. **Tarjetas y cuentas:** con dos movimientos casi iguales, «Juzgar con IA» da un veredicto y una razón corta; verifica que NO se borra ni fusiona nada.
7. **Préstamos:** en el simulador, «En palabras sencillas» muestra cuatro tarjetas; con IA el texto cita las cifras del simulador (marcadas «Simulación»).
8. **Ahorros y objetivos:** proyección, reparto y viabilidad; las cifras coinciden con la pantalla de Objetivos.
9. **Panel:** «Resumen financiero» (semana y mes), «Ordenar indicadores» y, en cada indicador, «¿Cómo se calculó?» → «Explícame».
10. **Fallos:** apaga el interruptor (nada debe enviarse y todo muestra su texto calculado); pon el teléfono en modo avión (mensaje de sin conexión, la app sigue completa). Si ves un texto de IA con un monto que no es el de la pantalla, es un fallo: repórtalo.
11. En SQL, `select feature, count(*), sum(input_tokens + output_tokens) from xmoney.ai_usage group by feature;` debe mostrar cada función que probaste (y solo esas).
