# X Money — guía para Claude Code

App personal de Xaviel con datos reales. **Regla de oro: integridad de datos antes que visualizaciones.** Un bug que
corrompa o pierda datos es peor que cualquier función que falte.

## Stack y comandos
Angular 22 (standalone + Signals), SCSS, Capacitor/Android, PWA. Datos: hoy localStorage espejado a Capacitor
Preferences; desde el prompt 00b, base en Supabase `x-core` con copia local y sincronización.

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
- `src/shared/domain/` cálculos financieros **puros** (ver su README) · `src/shared/utils/money.ts` redondeo a 2 decimales.
- `src/shared/testing/` builders (`account()`, `transaction()`, `category()`, `recurring()`) y `MemoryStorage`/`boot()`.
- `src/shared/characterization/` pruebas que fijan el comportamiento actual (`KNOWN GAP:` = violación documentada).
- `docs/` AUDITORIA, INTEGRIDAD, VISION, ROADMAP, IA, ARQUITECTURA. `supabase/migrations/` SQL (prefijo `xmoney_`, schema `xmoney`); **no lo aplica Claude**, lo aplica Xaviel.

## Convenciones
- Signals y componentes standalone. Código, nombres y comentarios en inglés; comentarios solo donde el porqué no sea obvio.
- Interfaz bilingüe: toda cadena visible entra por `TranslateService` (inglés = clave, español en el mapa `ES`); sin claves repetidas, sin texto suelto en plantillas.
- Dinero: nunca sumar ni comparar flotantes sin redondear (`money.ts`). RD$ y US$ nunca se mezclan ni se convierten con tasas inventadas.
- Cálculos en funciones puras de `shared/domain` con pruebas (cero, negativos, redondeo, fin de mes, bisiesto, USD vs DOP, listas vacías). Los componentes no calculan dinero.
- Proyecciones/inferencias: se devuelven y muestran marcadas como estimación, con supuestos visibles.
- Toda entidad se guarda por la capa de datos; todo cambio de forma lleva migración + prueba con datos de la forma anterior; no romper la importación de respaldos viejos.
- Reutilizar antes de crear (`shared/services`, `shared/ui`, `shared/models`, `:root` en `styles.scss`).

## Versión
No vive en `package.json` (0.0.0): `android/app/build.gradle` (`versionName`, `versionCode`) y mensaje de commit `vX.Y.Z: resumen`. El número visible está en Ajustes (`settings.html`).

## Fin de línea
El árbol suele mostrar ~100 archivos "modificados" solo por CRLF/LF. No normalizar, no commitear, no "arreglar": usar `git diff --ignore-space-at-eol`.

## Integridad (resumen; detalle en `docs/INTEGRIDAD.md`)
1 transferencia ≠ ingreso/gasto · 2 compra con tarjeta = un gasto · 3 pagar la tarjeta no recontabiliza · 4 beneficios no monetarios ≠ efectivo · 5 ventas ≠ ganancia neta · 6 inventario del negocio separado de bienes personales · 7 ingreso variable ≠ recurrente garantizado · 8 gasto ocasional sigue siendo variable · 9 saldos = movimientos consistentes · 10 proyecciones = estimaciones. Si una regla choca con un prompt, gana la regla.

## Seguridad e IA (resumen; detalle en `docs/IA.md`)
- Ninguna API key, token o secreto en el repo, el bundle, entornos del cliente ni capturas. No leer ni copiar `.env` de otros repos (SGC, csd-app). La service role key de Supabase jamás entra a la app.
- IA: capacidad transversal, nunca chatbot; los cálculos críticos son determinísticos y la IA no inventa cifras; la app calcula y manda solo agregados, con opt-in en Ajustes; todo pasa por una capa única en el backend de `x-core`.

## Trabajo
Sin commit ni push salvo que se pidan. Antes de dar algo por terminado: `npm run build` limpio y `npm test` en verde, con la salida real.
