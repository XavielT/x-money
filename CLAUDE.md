# X Money — guía para Claude Code

App personal de Xaviel con datos reales. **Regla de oro: integridad de datos antes que visualizaciones.** Un bug que
corrompa o pierda datos es peor que cualquier función que falte.

## Stack y comandos
Angular 22 (standalone + Signals), SCSS, Capacitor/Android, PWA. Datos (2.6.0): fuente de verdad en Supabase `x-core`
(schema `xmoney`, solo vía la Edge Function `xmoney-api`), copia local en IndexedDB y sincronización offline-first. Sin
`apiUrl` en `src/shared/config/app-config.ts` la app corre en modo solo local.

```bash
npm start                 # ng serve, http://localhost:4200
npm run build             # producción → dist/x-money/browser
npm test -- --no-watch    # vitest vía ng test (una sola pasada)
npx cap sync android      # copia el build al proyecto nativo
cd android && gradlew.bat assembleDebug   # APK (JAVA_HOME: Android Studio\jbr)
```
Angular CLI 22 exige Node ≥ 22.22.3 (o ≥ 24.15 / 26). Con Node 20/22.16 `ng` se niega a arrancar: `nvm install 22.22.3`.

## Estructura
- `src/app/pages/*` páginas (solo orquestan y muestran) · `src/shared/services` estado con signals · `models` · `data`
  (catálogos) · `ui` y `components` · `pipes` (`t` = traducción).
- Tarjetas de crédito (2.8.0): deuda = menos el saldo de la tarjeta (nunca se guarda); estados de cuenta en la colección `statements`; pagar una tarjeta es una transferencia `card-payment` (`CreditCardService.pay`); lo pagado de un estado se deriva de los pagos.
- Ingresos (2.9.0): fuentes en `incomeSources`, los movimientos apuntan con `incomeSourceId`; `IncomeService.monthBreakdown()` es la lectura para otros módulos (ingreso disponible = neto personal + beneficio neto comercial); lo esperado nunca se publica sin confirmar. Beneficios no monetarios (`BenefitService`) no tienen camino hacia saldos ni ingreso (regla 4). Los textos en español se cargan bajo demanda (`translations-es.ts`).
- Gastos y presupuestos (2.10.0): categorías con naturaleza (`nature`, esquema v3), subcategorías (`parentId`, máximo dos niveles; el movimiento conserva `categoryId` y agrega `subcategoryId`), `FixedExpenseService`, `BudgetService` (presupuestos por categoría, bloques, movimientos de dinero, `remainingThisMonth()`, `endOfMonthProjection()`, recomendaciones). La naturaleza nunca se infiere por repetición (regla 8).
- Captura inteligente (2.18.0): imagen, PDF, texto, voz y correo → **borradores** (`capture_drafts`, regla 11), nunca movimientos hasta que el usuario aprueba. `domain/capture/` (montos, fechas, palabras, resolución de cuentas, duplicados, plan de aprobación; todo puro), `CaptureService` (cola sin conexión, `approve` por los servicios de siempre), `capture_parse` en `xmoney-ai` (la única función que recibe un documento; interruptor y consentimiento propios), `xmoney-mail` (Gmail solo lectura, apagado). Pantallas `/capture` y `/capture/review`. Docs: `docs/CAPTURA.md`, `docs/SETUP-CAPTURA.md`. Los nombres de colección en el servidor son `[a-z0-9_]`: las claves camelCase se traducen en la frontera de sync (`toServerName`/`toClientKey`, `docs/INTEGRIDAD.md`); para colecciones nuevas usa snake_case.
- IA en los módulos (2.17.0): 30 funciones en `src/shared/ai/catalog.ts` (ingresos, gastos, presupuestos, negocios, tarjetas, préstamos, ahorros, dashboard), todas en la lista blanca del servidor (`supabase/functions/xmoney-ai/lib/features-modules.ts`; una prueba compara ambas listas). Siempre se muestra primero el texto **calculado** (alternativa determinística); la IA solo agrega lenguaje (marcadores `{x}`/`{{x}}`, cifras puestas por el dispositivo), clasifica, agrupa o reordena, y todo es una **sugerencia** que el usuario acepta. `AiAssistService` arma las entradas con agregados (`inputs.ts` + minimizador), `TextRuleService` guarda reglas locales aprendidas (colección `textRules`) que se aplican antes de llamar a la IA. Pantalla `/ai`, tarjetas `<app-ai-card>`, «Explícame» en cada indicador y pista de categoría en el formulario de gastos.
- Infraestructura de IA (2.16.0): la IA es opcional y nace **apagada**. Única puerta: `src/shared/ai/` (`AiService` → `AiGateway`/`XMoneyAiGateway` → función `xmoney-ai` de x-core, misma sesión que la sync). El servidor (`supabase/functions/xmoney-ai/`) tiene lista blanca de funciones con instrucciones propias, topes (300 solicitudes y 400.000 tokens al mes, 10 por minuto), tiempo de espera 20 s, un reintento solo en 429/5xx y registro de uso sin contenido (`xmoney.ai_usage`). La app manda solo agregados (`minimizer.ts`), las cifras las pone el código (`output.ts`: marcadores `{{x}}`, texto con cifras se descarta) y nada de IA cambia datos solo. La key del proveedor es un secreto de la función: nunca en el repo, el bundle ni el cliente.
- Inteligencia determinística (2.15.0): `domain/insights/` (`types.ts` contrato `Insight` y `Estimate<T>`, `detectors.ts` los 10 detectores puros, `engine.ts` reglas con umbrales, huella de evidencia, descartar/posponer, `projections.ts` adaptadores a `Estimate`). `SmartInsightService` corre los detectores **bajo demanda** y memoizados; ningún cálculo toca la red ni la IA; ninguna proyección devuelve un número desnudo (regla 10) y los beneficios no monetarios no son entrada de ningún detector (regla 4). Pantalla `/insights`, `ExplainSheet` («¿De dónde sale?»), ajustes «Alertas inteligentes» y avisos del dispositivo solo para las críticas.
- Préstamos (2.14.0): `domain/loans.ts` motor de amortización puro (francés, alemán, tasa plana; TNA/TEA; mensual/quincenal/semanal; seguros, comisiones, cargos; costo efectivo = TIR; abonos, cancelación, cambios de tasa), `domain/loan-ops.ts` (saldo derivado, reparto de pagos, alertas) y `domain/borrowing.ts` (capacidad de pago por niveles de ingreso; **los beneficios no monetarios no entran nunca**, regla 4). `LoanService` (`loans`, `loanSimulations`, `loanSettings`): el desembolso es un movimiento `loan-disbursement` que NO es ingreso; cada pago se divide en capital (`loan-principal`, no es gasto) e intereses/cargos (`loan-payment`, categoría «Intereses y cargos de préstamos»); lo que se debe nunca se guarda. `isCounted` excluye desembolso y capital. Pantallas `/loans` y `/loans/simulator`.
- Objetivos (2.13.0): `GoalModel` en la colección sincronizada `goals` (aportes y retiros embebidos); un objetivo es un **apartado virtual**: no mueve dinero ni cambia saldos, baja el «dinero disponible» y cuenta como reservado (la cuenta asociada es solo informativa). `domain/goals.ts` puro (progreso, recordatorios, proyección plan/ritmo real, viabilidad, fondo de emergencia); capital comercial reservado se muestra y suma aparte; «Usar para inventario» = retiro del objetivo + una compra de `BusinessService`, sin duplicar movimientos.
- Dashboard (2.11.0): `DashboardService` solo compone servicios existentes (nada de dinero propio); los indicadores de módulos futuros se ocultan (`available: false`), nunca en cero; ver `docs/DASHBOARD.md`. Los módulos 06/07/08 entregan sus cifras con `DashboardService.provide()`.
- Negocio (2.12.0): `scope` del movimiento (`personal` | `business`, esquema v4); lo `business` mueve saldos pero `isCounted` lo saca de ingresos/gastos/presupuestos personales. Comprar inventario = capital de trabajo; solo el beneficio neto de una venta llega al ingreso personal; el inventario nunca es bien personal (regla 6). Fórmulas en `docs/INTEGRIDAD.md`.
- `src/shared/domain/` cálculos financieros **puros** (ver su README) · `src/shared/utils/money.ts` redondeo a 2 decimales.
- `src/shared/data-layer/` registro de colecciones, copia local, motor de sincronización y cliente de la API; `supabase/` migración, función `xmoney-api` y pruebas SQL (`docs/SETUP-XCORE.md`).
- Esquema versionado: nueva forma de datos = una `Migration` en `data-layer/migrations.ts` + subir `CLIENT_SCHEMA_VERSION` + prueba con fixtures de la forma anterior. Los saldos solo salen de `domain/ledger.ts`; todo movimiento se escribe con `TransactionService` (valida, traza y audita).
- `src/shared/testing/` builders (`account()`, `transaction()`, `category()`, `recurring()`) y `MemoryStorage`/`boot()`.
- `src/shared/characterization/` pruebas que fijan el comportamiento actual (`KNOWN GAP:` = violación documentada).
- `docs/` AUDITORIA, INTEGRIDAD, VISION, ROADMAP, IA, ARQUITECTURA. `supabase/migrations/` SQL (`<timestamp>_xmoney_*.sql`, schema `xmoney`); **no lo aplica Claude**, lo aplica Xaviel.

- Interfaz (2.21.0): editar **en su sitio** (el formulario sale justo bajo el elemento editado, uno a la vez: Cuentas, Categorías, Beneficios) con `src/shared/ui/reveal.ts` (`revealAndFocus`); la captura ya no es un botón flotante (cámara en el encabezado de Inicio, tarjeta de revisión, fila en Nuevo movimiento). Tabla de toques y cola de mejoras en `docs/UX.md`; `balanceAfterOpeningChange` (`domain/opening-balance.ts`) avisa antes de cambiar un saldo inicial.
- Módulos y lenguaje (2.22.0): `ModuleService` (`domain/modules.ts`, valor explícito en `settings.modules`, automático por datos) decide qué accesos, tarjetas de Inicio e indicadores se ven; apagar un módulo **nunca** borra ni deja de contar datos, y los avisos de pagos y recordatorios de metas se muestran siempre. Todo enlace a Ajustes sale de `SETTINGS_LINKS` (`config/settings-links.ts`). Una cifra principal por pantalla («Dinero en tus cuentas»). Guía y glosario en `docs/LENGUAJE.md` (la prueba `language.spec.ts` impide que vuelvan los términos viejos).
- Ajustes (2.23.0): `/settings` es un menú (`settings.ts`, filas de `domain/settings-menu.ts` con su línea de estado) y cada sección es su pantalla `/settings/<id>` (`pages/settings/screens/*`, rutas en `settings.routes.ts`; ids = claves de `SETTINGS_LINKS`, que ahora apunta a `/settings/<id>`). `/settings#<id>` redirige. Un control se mueve de pantalla, nunca de almacén (cuenta = `settings`, dispositivo = `device-prefs`). El historial de cambios escribe frases con `domain/describe-change.ts` (el JSON queda en «Show details»); estado de sync en `domain/sync-status.ts`; los respaldos salen por `BackupService`.

## Convenciones
- Signals y componentes standalone. Código, nombres y comentarios en inglés; comentarios solo donde el porqué no sea obvio.
- Interfaz bilingüe: toda cadena visible entra por `TranslateService` (inglés = clave, español en el mapa `ES`); sin claves repetidas, sin texto suelto en plantillas.
- Dinero: nunca sumar ni comparar flotantes sin redondear (`money.ts`). RD$ y US$ nunca se mezclan ni se convierten con tasas inventadas.
- Cálculos en funciones puras de `shared/domain` con pruebas (cero, negativos, redondeo, fin de mes, bisiesto, USD vs DOP, listas vacías). Los componentes no calculan dinero.
- Proyecciones/inferencias: se devuelven y muestran marcadas como estimación, con supuestos visibles.
- Toda colección nueva se registra en `data-layer/registry.ts` (sincronizada o solo del dispositivo). Los saldos nunca se guardan ni se sincronizan.
- Toda entidad se guarda por la capa de datos; todo cambio de forma lleva migración + prueba con datos de la forma anterior; no romper la importación de respaldos viejos.
- Reutilizar antes de crear (`shared/services`, `shared/ui`, `shared/models`, `:root` en `styles.scss`).

## Versión
No vive en `package.json` (0.0.0): `android/app/build.gradle` (`versionName`, `versionCode`) y mensaje de commit `vX.Y.Z: resumen`. El número visible sale de `APP_VERSION` en `src/shared/config/app-version.ts` (Ajustes y el botón «Buscar actualizaciones»): **debe ser igual a `versionName`** al subir de versión.

## Lanzamiento (norma del dueño, 05/11/2026): cada versión nueva en `main` se publica y se refleja en el portafolio
Cuando se suben a `main` cambios con **versión nueva** (`versionName`/`versionCode` en `android/app/build.gradle`, mensaje `vX.Y.Z: …`; el dueño ya autorizó que el APK sea **público**):
1. `git push`. El flujo `.github/workflows/android-release.yml` corre solo: pruebas, compilación, **firma con la llave de release**, y publica el *release* `vX.Y.Z` con `x-money.apk` y `x-money-X.Y.Z-release.apk`. Un push con la misma versión (p. ej. solo docs) no publica nada. Comprobar: `gh run list --workflow "Android release"` y `gh release view vX.Y.Z`.
2. La web (proyecto Vercel `x-money`) se despliega sola desde `main`; comprobar que quede READY.
3. **Portafolio** (`C:\dev\portfolio-v2`, tarjeta «X Money» en `src/app/app.ts`): actualizar versión/descripción si cambiaron funciones. Los enlaces son estables y no se tocan: web `https://x-money-xavielts-projects.vercel.app`, APK `https://github.com/XavielT/x-money/releases/latest`, descarga directa `…/releases/latest/download/x-money.apk`. Commit + push y comprobar su despliegue (`xaviel-web-v2` y `xaviel-web-v2-edh4`).
4. Instalar en el teléfono con `adb install -r` (la nube y este equipo firman con el mismo certificado `a20e7249…`).
La llave **nunca** va al repositorio (es público): vive en `android/` (ignorada) y en los secretos de GitHub (`docs/ACTUALIZAR-APP.md`).

## Fin de línea
El árbol suele mostrar ~100 archivos "modificados" solo por CRLF/LF. No normalizar, no commitear, no "arreglar": usar `git diff --ignore-space-at-eol`.

## Integridad (resumen; detalle en `docs/INTEGRIDAD.md`)
1 transferencia ≠ ingreso/gasto · 2 compra con tarjeta = un gasto · 3 pagar la tarjeta no recontabiliza · 4 beneficios no monetarios ≠ efectivo · 5 ventas ≠ ganancia neta · 6 inventario del negocio separado de bienes personales · 7 ingreso variable ≠ recurrente garantizado · 8 gasto ocasional sigue siendo variable · 9 saldos = movimientos consistentes · 10 proyecciones = estimaciones. Si una regla choca con un prompt, gana la regla.

## Seguridad e IA (resumen; detalle en `docs/IA.md`)
- Ninguna API key, token o secreto en el repo, el bundle, entornos del cliente ni capturas. No leer ni copiar `.env` de otros repos (SGC, csd-app). La service role key de Supabase jamás entra a la app.
- IA: capacidad transversal, nunca chatbot; los cálculos críticos son determinísticos y la IA no inventa cifras; la app calcula y manda solo agregados, con opt-in en Ajustes; todo pasa por una capa única en el backend de `x-core`.

## Trabajo
Sin commit ni push salvo que se pidan. Antes de dar algo por terminado: `npm run build` limpio y `npm test` en verde, con la salida real.
