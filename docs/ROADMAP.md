# Roadmap — ronda de noviembre 2026

Regla: **ningún prompt se corre sin que el anterior esté commiteado y probado en el teléfono.**

| Prompt | Tema | Versión destino | Estado |
|---|---|---|---|
| 00 | Fundamentos: auditoría, documentación y base de pruebas | 2.5.2 | **hecho** (commiteado y probado en el teléfono) |
| 00b | Cuenta, base de datos en x-core y sincronización | 2.6.0 | **hecho** (SQL aplicado y función desplegada en x-core; commiteado) |
| 01 | Integridad financiera P0 | 2.7.0 | **hecho** (pendiente: commit y prueba en teléfono; la migración de datos corre sola al abrir la app) |
| 02 | Tarjetas de crédito | 2.8.0 | **hecho** (01 commiteado y subido; pendiente: commit de 02 y prueba en teléfono; el permiso de notificaciones se pide al activar «Avisos de tarjeta») |
| 03 | Ingresos y beneficios laborales | 2.9.0 | **hecho** (02 commiteado y subido; pendiente: commit de 03 y prueba en teléfono) |
| 04 | Gastos, categorías y presupuestos | 2.10.0 | **hecho** (03 commiteado y subido; pendiente: commit de 04 y prueba en teléfono; la migración v3 de categorías corre sola al abrir la app) |
| 05 | Dashboard | 2.11.0 | **hecho** (04 commiteado y subido; pendiente: commit de 05 y prueba en teléfono; no hay migración de datos) |
| 06 | Negocios e inventario | 2.12.0 | **hecho** (05 commiteado y subido; pendiente: commit de 06 y prueba en teléfono; la migración v4 marca todo lo existente como personal al abrir la app) |
| 07 | Ahorros y objetivos | 2.13.0 | **hecho** (06 commiteado y subido; pendiente: commit de 07 y prueba en teléfono; no hay migración de datos: `goals` es una colección nueva y los respaldos viejos se importan sin ella) |
| 08 | Préstamos | 2.14.0 | **hecho** (07 commiteado y subido; pendiente: commit de 08 y prueba en teléfono; no hay migración de datos: `loans`, `loanSimulations` y `loanSettings` son colecciones nuevas y los respaldos viejos se importan sin ellas) |
| 09 | Inteligencia determinística | 2.15.0 | **hecho** (08 commiteado y subido; pendiente: commit de 09 y prueba en teléfono; no hay migración de datos: `insightStates` e `insightSettings` son colecciones nuevas y los respaldos viejos se importan sin ellas) |
| 10 | Infraestructura de IA | 2.16.0 | **hecho** (09 commiteado y subido; pendiente: commit de 10, **SQL y despliegue de `xmoney-ai` por Xaviel** (docs/SETUP-XCORE.md, sección «IA») y prueba en teléfono; la IA nace apagada) |
| 11 | IA en los módulos | 2.17.0 | **hecho** (10 sin commitear al empezar este; pendiente: commit de 10 y 11, redespliegue de `xmoney-ai` con la lista blanca ampliada (docs/SETUP-XCORE.md) y prueba con la IA real siguiendo el guion de docs/IA.md; la IA sigue apagada por defecto) |
| 12 | Captura inteligente (imagen, PDF, voz, texto, correo) | 2.18.0 | **hecho** (11 y 10 commiteados y subidos antes de empezar; la función `xmoney-ai` se redesplegó con `capture_parse` y la migración de `ai_usage` está aplicada; pendiente: aplicar `202611051200_xmoney_mail_connections.sql` y los pasos de `docs/SETUP-CAPTURA.md` solo si quieres el correo, redesplegar `xmoney-ai`, y la prueba con el teléfono real; la captura nace apagada) |

Prioridad de fondo: P0 integridad → P1 control → P2 negocios → P3 planificación → P4 inteligencia (`docs/VISION.md`).
La versión vive en `android/app/build.gradle` (`versionName`/`versionCode`) y en el mensaje de commit `vX.Y.Z: …`.

## Después de la ronda 12 (05/11/2026): versiones 2.19.x
- **2.19.1–2.19.5**: app real en el teléfono con llave de release; cuentas creadas desde capturas de Banreservas y Popular; arreglos
  de campos de monto que perdían el foco, editor «Tapar partes», banco + últimos 4 en los borradores, impuesto bancario en pagos y
  transferencias, detalle de cuenta (tocar una cuenta ya no abre la edición), tarjeta mostrada como deuda, filas de cuentas sin
  texto apretado.
- **Infraestructura**: web/PWA en Vercel (`x-money`), sitio de privacidad y condiciones (`x-money-site`, `site/`), Gmail conectado
  en modo solo lectura (app publicada en Google), y lanzamiento automático: cada `versionName` nuevo en `main` publica un release
  firmado en GitHub (`CLAUDE.md` → «Lanzamiento»).
- **Pendiente**: probar la lectura del correo con un aviso bancario nuevo; confirmar que el token de Gmail ya no caduca a los 7 días;
  copia fuera de línea de la llave de firma; tilde en la categoría «Pastelería» (estético).
