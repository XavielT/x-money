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
1. **Exporta el respaldo desde la app vieja:** Ajustes → «Export JSON backup» (guárdalo con «Compartir» en Drive o en
   Descargas). Es el respaldo funcional; el `.tar` de arriba es la red de seguridad técnica. Las versiones nuevas importan
   respaldos viejos (hay migraciones con pruebas).
2. **Evita duplicados:** en la cuenta `xavieldev@gmail.com` (la de la copia de prueba) ya están creadas por captura 4
   cuentas (Popular ×2, Banreservas ×2) con 0 movimientos. Si tu app vieja ya las tiene, al importar quedarían dobles.
   Arréglalo **antes** archivándolas o borrándolas en la copia de prueba (Cuentas → menú de la cuenta).
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
