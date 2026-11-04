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

Prioridad de fondo: P0 integridad → P1 control → P2 negocios → P3 planificación → P4 inteligencia (`docs/VISION.md`).
La versión vive en `android/app/build.gradle` (`versionName`/`versionCode`) y en el mensaje de commit `vX.Y.Z: …`.
