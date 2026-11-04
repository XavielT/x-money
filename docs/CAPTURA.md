# Captura inteligente (2.18.0)

Registrar gastos e ingresos pasando una captura de un aviso del banco, una factura (imagen o PDF), tu voz,
texto pegado o tu correo. Origen: nota N14 de Xaviel (03/11/2026).

## Cómo funciona (en una línea)

**Una captura nunca registra nada: produce un BORRADOR que tú apruebas** (regla 11 de `INTEGRIDAD.md`). El modelo
solo *lee*; el código *decide*: los montos y fechas los convierte el dispositivo (`domain/capture/amount.ts`,
`dates.ts`), las cuentas se resuelven contra tus propias cuentas, y al aprobar todo pasa por los mismos servicios
que cualquier otro movimiento (con su validación, auditoría y reverso).

```
imagen / PDF / texto / voz / correo
   → (reducir y limpiar en el dispositivo)  → xmoney-ai · capture_parse  → JSON de forma fija
   → (convertir y resolver en el dispositivo) → BORRADOR en la bandeja → [tu decisión] → movimiento(s)
```

## Qué sale del dispositivo y qué no

| Sale (solo si enciendes «Captura inteligente» y envías) | No sale |
|---|---|
| La imagen o el PDF de **esa** captura (imagen reducida a 1600 px, sin metadatos, con tus recuadros negros) | El resto de tus datos: cuentas, saldos, movimientos, metas, préstamos |
| El texto de **esa** captura (aviso, tu frase dictada, correo), sin firmas, pies legales ni números largos | Los nombres de tus cuentas, bancos, los últimos 4 dígitos de **tus** cuentas, ids |
| | El audio: la voz se convierte en texto en el teléfono; solo el texto viaja |
| | Las claves del proveedor y los tokens del correo (viven solo en el servidor) |

- Camino: dispositivo → función `xmoney-ai` de `x-core` → Anthropic. El servidor **no guarda** el documento ni el
  texto, no los escribe en registros y no los reenvía; guarda solo la cuenta, la función, los tokens, el costo
  estimado, el resultado y la fecha (`xmoney.ai_usage`).
- El archivo original se borra del dispositivo cuando apruebas o rechazas el borrador. «Guardar comprobante»
  (apagado por defecto) conserva **solo una miniatura local**; los comprobantes no se sincronizan.
- Consentimiento: pantalla propia al encender el interruptor (con fecha); se retira apagándolo. «No volver a
  mostrar la vista previa» oculta la vista previa, **no** el consentimiento.
- **Voz en el navegador (no en el teléfono con el plugin):** si usas el micrófono en Chrome (web), el *navegador*
  puede enviar el audio al servicio de reconocimiento de su fabricante; eso queda fuera del control de X Money. En
  Android (APK) se usa el reconocimiento del teléfono. Donde no hay reconocimiento (varios casos en iPhone) se usa
  el micrófono del teclado.
- Retención del proveedor: ver `docs/IA.md` («Retención de datos de Anthropic»).

## Fuentes soportadas

| Fuente | Cómo | Notas |
|---|---|---|
| Imagen | Galería, cámara, pegar (Ctrl+V) y arrastrar y soltar; hasta 10 a la vez | JPEG, PNG, WebP (HEIC solo si el navegador lo abre; si no, conviértelo) |
| PDF | Elegir archivo | Máximo 5 MB y 10 páginas; más grande: recórtalo |
| Texto pegado | Cuadro «Escribe, pega o dicta» | Hasta 6.000 caracteres |
| Voz | Botón «Hablar» (es-DO, con respaldo es-419/es) | Se muestra el texto para que lo corrijas antes de enviar |
| Compartir desde otra app | Android: «Compartir → X Money» (imagen, PDF o texto). PWA en Chrome/Android: `share_target` | **iPhone no tiene destino de compartir para PWA**: usa elegir archivo o pegar |
| Correo | Gmail, solo lectura, filtro por remitentes (ver `SETUP-CAPTURA.md`) | Interruptor propio, apagado por defecto |

**No soportado en esta ronda:** aprobación automática, notificaciones de Android o SMS, conexión directa a bancos,
OCR local sin IA, grabar o enviar audio, proveedores de correo distintos de Gmail, sincronizar comprobantes.

## La bandeja «Revisar capturas»

- Cada borrador muestra el original junto a los campos; los dudosos (monto que no está en el texto, fecha supuesta,
  cuenta ambigua, moneda sin definir, monto muy grande) salen resaltados con su explicación.
- Acciones: **Aprobar** (solo si no falta ni es ambiguo ningún campo esencial), **Rechazar**, **Aprobar las
  marcadas** (solo las que marcas; no existe «aprobar todo»), **Registrar igual** (posibles duplicados).
- Aprobar crea: gasto, ingreso, pago de tarjeta (transferencia `card-payment`, **no** gasto), transferencia entre
  tus cuentas (no es ingreso ni gasto), aporte a una meta, pago de un préstamo, o compra con factura (**un** gasto
  por el total; el ITBIS queda como dato; si marcas «de mi negocio», pasa por la compra de inventario del negocio).
- Procedencia: la auditoría registra `capture:<fuente>` y el id del borrador; el movimiento se revierte como
  cualquier otro. Los borradores aprobados quedan en el historial («registrado desde captura»).
- Pendientes de más de 7 días: aviso; **nunca** se aprueban ni se borran solos.
- Aprende local: si apruebas comercio→categoría o pagador→fuente, la próxima vez se sugiere sola (`textRules`).
- Duplicados: el mismo archivo dos veces (huella SHA-256) se marca antes de gastar una llamada; la misma
  transacción como captura y como correo comparte la clave; un movimiento que anotaste a mano el mismo día (±1 día,
  mismo monto) pide decisión explícita.

## Límites

- 40 capturas al día por cuenta (el servidor) y por dispositivo (la app); tope mensual de costo (5 US$ por
  defecto, solo cuenta llamadas con precio conocido: sin `XMONEY_PRICES` no se activa) y los topes mensuales de la IA
  general. Al alcanzarlos: mensaje claro y el formulario manual.
- Sin conexión: la captura espera en el dispositivo (máximo 10) y se lee sola al volver la red.
- Todo lo que viene de un documento, audio o correo es **dato no confiable**: el modelo no tiene herramientas, la
  salida tiene forma fija, y un texto que parezca una orden se ignora.

## Guion de prueba manual (teléfono real)

1. Ajustes → «Captura inteligente» → encender → leer el consentimiento → «Entiendo, encender».
2. **Un consumo:** pasa una captura del aviso de tu banco (con el número de cuenta tapado si quieres). Comprueba
   que sale el borrador con monto, fecha, comercio y la cuenta; aprueba; verifica el saldo y que aparece en el
   historial. Revierte el movimiento y comprueba el saldo.
3. **Un depósito:** igual, con una captura de una entrada de dinero; comprueba que sugiere la fuente de ingreso.
4. **Una factura en PDF:** elige el PDF; comprueba NCF/ITBIS y que se registra **un** gasto por el total.
5. **Por voz:** «gasté mil quinientos pesos en el colmado con la tarjeta del Popular»; y «gasté 500 en gasolina y
   300 en el colmado» (deben salir 2 borradores).
6. **Compartir:** en la app de correo o la galería → Compartir → X Money; debe abrir «Capturar» con el contenido.
7. **Sin conexión:** modo avión, captura una imagen: queda «en cola»; quita el modo avión y se lee sola.
8. **Duplicado:** pasa la misma captura dos veces: la segunda sale como duplicado.
9. **Correo** (cuando conectes Gmail, `SETUP-CAPTURA.md`): pon un remitente, «Buscar en mi correo»; solo deben
   aparecer avisos de ese remitente.
10. Apaga el interruptor: «Leer en este dispositivo» sigue leyendo frases; imágenes y PDF piden encenderlo.

Muestras reales para evaluar tú mismo: `docs/muestras-bancos/` (ignorada por git; ver su README).
