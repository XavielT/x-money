# Actualizar la app real del teléfono (de la v1.0 a la 2.19.x)

## Por qué no se puede actualizar encima

Android solo deja actualizar una app si el APK nuevo está firmado con **la misma llave** que el instalado. Tu app real
(`com.xaviel.xmoney`, v1.0 del 15/07/2026) está firmada con una llave de **depuración de otro equipo** (SHA-256
`fe5e6329…a293a99`); la de este equipo es otra (`BB:25:6D:D2…`) y nunca existió una llave de release
(`x-money-release.jks` no estaba en ningún sitio). Instalar encima falla con `INSTALL_FAILED_UPDATE_INCOMPATIBLE`, y la
única forma de «forzarlo» es desinstalar, que **borra los datos locales** de la app vieja. Por eso la ruta empieza con
respaldos.

## Lo que ya está preparado (2026-11-05)

| Qué | Dónde |
|---|---|
| Llave de release nueva (RSA 2048, 30 años, alias `xmoney`) | `android/x-money-release.jks` + `android/keystore.properties` (**fuera de git**) |
| Huella de la llave nueva | SHA-256 `a20e7249 10b3a8739c99d2fab0a7bbe5feefcf013f0a9a95254a4748a211d3fe` |
| APK de release 2.19.1, firmado y **no depurable** | `C:\Users\xavie\x-money-respaldo-2026-11-05\x-money-2.19.1-release.apk` |
| Respaldo completo de los datos privados de la app vieja | `…\app-vieja-datos.tar` (almacenamiento web, preferencias, bases) |
| El APK original de la v1.0 (para volver atrás) | `…\x-money-v1.0-original-firmada-con-llave-vieja.apk` |

> **Respalda YA la llave** (`android/x-money-release.jks` y `android/keystore.properties`) en un sitio fuera de este
> equipo (USB, gestor de contraseñas). Si la pierdes, **nunca más** podrás actualizar la app en su sitio: tendrías que
> repetir esta migración. No las subas a git ni las pegues en chats.

## Ruta A (si todavía tienes el equipo donde se hizo la v1.0)

Copia su `~/.android/debug.keystore` a este equipo (si su huella SHA-256 es `fe5e6329…`: `keytool -list -v -keystore
debug.keystore -storepass android`), y `gradlew assembleDebug` firmará con la misma llave: se actualiza encima y **no se
pierde nada**. No hace falta nada más de esta guía. (La app 2.19.1 de depuración no es lo ideal para uso diario: la ruta B
es la recomendada.)

## Ruta B (recomendada): pasar a la llave de release, sin perder datos

0. **Apunta cifras de la app vieja** para comprobar al final: saldo total y cuántas cuentas, movimientos, presupuestos y
   metas tiene (Cuentas y Ajustes).
1. **El respaldo de la app vieja** (hecho el 05/11/2026): el botón «Export backup (JSON)» de la v1.0 no genera archivo en
   este WebView, así que se reconstruyó leyendo su almacenamiento (la app es depurable): `x-money-respaldo-app-vieja.json`
   (16 cuentas, 7 movimientos, 28 categorías), validado con el importador real de la app nueva, y copiado a Descargas del
   teléfono. El `.tar` es la red de seguridad técnica.
2. **Duplicados: no hay que hacer nada.** «Import backup» **reemplaza** los datos (en todos tus dispositivos si hay sesión)
   y guarda antes un respaldo de los actuales; las 4 cuentas de prueba creadas por captura se sustituyen por las del respaldo.
3. **Desinstala la app vieja:** `adb uninstall com.xaviel.xmoney` (o desde Ajustes del teléfono). Desde aquí los datos
   locales solo existen en los respaldos del paso 1 y del `.tar`.
4. **Instala la nueva:**
   `"C:\SDKs\Android\sdk\platform-tools\adb.exe" install "C:\Users\xavie\x-money-respaldo-2026-11-05\x-money-2.19.1-release.apk"`
   (o pásala al teléfono y ábrela; permite «instalar apps desconocidas» si lo pide).
5. **Entra con tu cuenta** (`xavieldev@gmail.com`). La pantalla «Upload your data» / «Choose» decide qué hacer con lo del
   teléfono y lo del servidor; después usa Ajustes → «Import JSON backup» con el archivo del paso 1.
6. **Compara** con las cifras del paso 0. Si cuadran, termina: **todas las actualizaciones futuras serán en su sitio**.

### Si algo sale mal (volver atrás)

```
adb uninstall com.xaviel.xmoney
adb install "C:\Users\xavie\x-money-respaldo-2026-11-05\x-money-v1.0-original-firmada-con-llave-vieja.apk"
adb push "C:\Users\xavie\x-money-respaldo-2026-11-05\app-vieja-datos.tar" /data/local/tmp/
adb shell "run-as com.xaviel.xmoney sh -c 'tar xf /data/local/tmp/app-vieja-datos.tar'"
```
Eso devuelve la app v1.0 con sus datos tal como estaban (funciona porque ese APK es depurable y conserva su firma).

## Actualizaciones futuras (con la llave de release)

```
cd C:\dev2\x-money
npm run build
npx cap sync android
cd android
gradlew.bat assembleRelease        (JAVA_HOME: Android Studio\jbr)
adb install -r app\build\outputs\apk\release\app-release.apk
```
`-r` actualiza **conservando los datos**. Sube `versionCode` en `android/app/build.gradle` en cada versión.

## Copia de prueba (`com.xaviel.xmoney.t12`)

Es una copia aparte que usé para probar; no comparte datos con la app real, pero entra a **la misma cuenta del servidor**.
Cuando termines la migración, desinstálala: `adb uninstall com.xaviel.xmoney.t12`.

## Llave en GitHub: lanzar versiones sin tener la llave a mano

La llave de release vive en **tres sitios**; cada uno cumple una función distinta:

| Dónde | Para qué |
|---|---|
| `android/x-money-release.jks` + `android/keystore.properties` (esta carpeta, **ignoradas por git**) | Compilar en este equipo (`gradlew assembleRelease`). Claude Code siempre sabe dónde están. |
| **Secretos del repositorio en GitHub** (`ANDROID_KEYSTORE_B64`, `…_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`) | Compilar y firmar **desde la nube**, sin este equipo. Están cifrados y **GitHub no los devuelve nunca**. |
| **Una copia fuera de línea** (USB o gestor de contraseñas) | La única forma de recuperarla si se pierde el equipo. Los secretos de GitHub no sirven como respaldo. |

**Nunca** se sube la llave al repositorio, ni cifrada: el repositorio es **público**.

### Cargar los secretos (una sola vez, en su terminal, desde la carpeta del proyecto)
```
.\scripts\set-release-secrets.ps1
```
Lee los dos archivos locales y los sube con `gh secret set`, sin imprimir nada sensible. Requiere `gh auth status` activo.

### Lanzar una versión (automático)
1. Subir `versionCode` y `versionName` en `android/app/build.gradle`, commit y push a `main`.
2. El flujo `.github/workflows/android-release.yml` detecta la versión nueva, corre las pruebas, compila, **firma**, **falla si el certificado no es `SHA-256 a20e7249…`** (con otro, Android no actualizaría encima) y publica el *release* `vX.Y.Z` con `x-money.apk` (nombre fijo) y `x-money-X.Y.Z-release.apk`.
3. Instalar con `adb install -r` (mismos datos conservados). Un push con la misma versión no publica nada; *Actions → Run workflow* solo deja el APK como *artifact* (30 días).
4. Reflejarlo en el portafolio (ver «Lanzamiento» en `CLAUDE.md`).

Las solicitudes de cambios (forks) nunca corren el flujo ni reciben los secretos.

## Actualizar desde la propia app (2.20.7)

Ajustes → «Actualizaciones de la app» → **Buscar actualizaciones**, y un aviso en cualquier pantalla cuando hay una versión
nueva (la app mira al abrirla y cada vez que vuelve al primer plano, como máximo cada 30 minutos).

- **PWA / iPhone:** el service worker guarda una copia de la app y un iPhone puede seguir sirviendo una vieja durante días.
  «Actualizar» le pide los archivos nuevos al service worker, los activa y recarga. Tus datos no se tocan.
- **App de Android (APK):** los archivos web viajan dentro del APK, así que una versión nueva es un APK nuevo. La app lee
  el último *release* público de GitHub (un solo GET, no envía nada tuyo) y «Actualizar» abre la descarga de
  `…/releases/latest/download/x-money.apk` (la dirección se construye en la app, nunca sale de lo que responda la red). Android
  lo instala **encima** porque lo firma la misma llave de release: los datos se quedan. La primera vez Android pide permitir
  «instalar apps desconocidas» al navegador. Un release cuyo APK aún no está adjunto (el flujo sigue corriendo) no cuenta
  como actualización.
- El número de versión sale de `APP_VERSION` (`src/shared/config/app-version.ts`) y **debe ser igual a `versionName`** de
  `android/app/build.gradle`: si no, la app creería que hay una actualización que ya tiene (o no vería una real).
- Lo que **no** hace: no instala sola ni en segundo plano, y no cambia nada sin que toques «Actualizar».
- Se probó en el teléfono con una copia que decía ser 2.20.0: el aviso apareció solo, «Actualizar» abrió la descarga de
  `x-money.apk` en el navegador y no se instaló nada.
