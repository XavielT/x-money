# Puesta en marcha de X Money en x-core

## Estado (3/11/2026): ya aplicado en x-core por Claude Code, con tu autorización
- Migración `202611031200_xmoney_schema.sql` aplicada en x-core (`nakgrkcqyuycadeuenuw`, producción).
- Función `xmoney-api` desplegada con `--no-verify-jwt`; secretos `XMONEY_TOKEN_SECRET`, `XMONEY_SIGNUP_CODE` y
  `XMONEY_ALLOWED_ORIGINS` definidos. `apiUrl` ya apunta a la función.
- Verificado desde fuera: `…/rest/v1/accounts` con `Accept-Profile: xmoney` responde `PGRST106 Invalid schema` (el schema
  no está expuesto) y una prueba de punta a punta contra la base real (registro, login, push, pull, conflicto, reuso de
  refresco) pasó. **No pude correr `supabase/tests/xmoney_isolation.sql`** (no hay forma de ejecutar SQL arbitrario con la
  CLI sin Docker): córrelo tú en el editor SQL, y revisa que `xmoney` no esté en "Exposed schemas".
- Quedaron 3 cuentas de prueba (`smoke-test@`, `smoke-test2@`, `smoke-test3@example.invalid`): bórralas con
  `delete from xmoney.accounts where email like 'smoke-test%@example.invalid';` (sus sesiones y registros caen en cascada).
- `XMONEY_ALLOWED_ORIGINS` solo tiene `http://127.0.0.1:4200`; añade tu dominio web cuando lo tengas
  (`supabase secrets set XMONEY_ALLOWED_ORIGINS="https://tu-dominio,http://127.0.0.1:4200"`).
- Los pasos de abajo siguen siendo la referencia para repetirlo o auditarlo.

Todo esto lo haces tú (Xaviel). Claude Code solo escribió el SQL y la función; **nada se ha aplicado ni desplegado**
y no hay credenciales de x-core en este repo. Nunca pongas la service role key en la app ni en el repo.

Qué hay: schema propio `xmoney` (no `public`) + una Edge Function `xmoney-api` que es la única puerta a esas
tablas. La app no usa supabase-js, ni Supabase Auth, ni la anon key: solo conoce la URL de la función.

## Pasos, en orden

1. **Mira el historial para no chocar con otras apps:** `supabase migration list` (proyecto x-core). Su archivo lleva `xmoney` en el
   nombre (la CLI exige `<timestamp>_nombre.sql`, no admite un prefijo antes del timestamp): `supabase/migrations/202611031200_xmoney_schema.sql`.
2. **Revisa y aplica el SQL.** Léelo entero (crea el schema `xmoney`, 5 tablas, el trigger de `rev`, quita permisos
   a `anon`/`authenticated` y activa RLS sin políticas). Aplícalo desde el editor SQL de Supabase o con
   `supabase db push` (tú decides; no toca `public` ni `auth`). Antes de aplicar, anota para el paso 5 cuántas
   políticas y grants tiene el proyecto (consulta 6 del script).
3. **Confirma que el schema NO está expuesto:** Dashboard → Settings → API → "Exposed schemas" no debe listar
   `xmoney`. Si por defecto lo agregara, quítalo.
4. **Corre el script de aislamiento:** pega `supabase/tests/xmoney_isolation.sql` en el editor SQL. Todo debe decir
   `PASS` (anon/authenticated sin acceso, sin USAGE, RLS activa sin políticas, schema no expuesto, índice único de
   correo solo en `xmoney.accounts`) y los conteos de la consulta 6 deben ser iguales a los que anotaste.
5. **Genera los secretos y defínelos** (no los pegues en el chat ni en archivos del repo):
   ```bash
   openssl rand -base64 48                      # → XMONEY_TOKEN_SECRET (mínimo 32 bytes)
   supabase secrets set XMONEY_TOKEN_SECRET="<valor>"
   supabase secrets set XMONEY_SIGNUP_CODE="<un código largo que solo tú sepas>"
   supabase secrets set XMONEY_ALLOWED_ORIGINS="https://<tu-dominio-web>"   # separados por coma; ya van incluidos capacitor://localhost, https://localhost y http://localhost:4200/4300
   ```
   Sin `XMONEY_SIGNUP_CODE` el registro queda desactivado. Con `XMONEY_TOKEN_SECRET` ausente o corto la función
   responde `server_misconfigured`. `SUPABASE_DB_URL` ya viene en el entorno de las Edge Functions.
6. **Despliega la función con la verificación de JWT desactivada:**
   `supabase functions deploy xmoney-api --no-verify-jwt`
   (si la CLI pide un proyecto, ejecuta `supabase init` en este repo y `supabase link --project-ref <ref de x-core>`;
   `link` modifica solo la CLI local, no x-core).
7. **Pon la URL en la app:** `src/shared/config/app-config.ts` → `apiUrl: 'https://<ref>.supabase.co/functions/v1/xmoney-api'`.
   No es un secreto. Mientras esté vacía la app funciona en modo solo local, como la 2.5.x. Reconstruye
   (`npm run build`, `npx cap sync android`, APK).
8. **Crea tu cuenta desde la app** (Crear cuenta + el código de invitación) y **guarda el código de recuperación**
   (se muestra una sola vez). La primera vez hace falta conexión; el asistente "Subir mis datos" hace un respaldo
   JSON, sube por lotes y verifica los conteos.
9. **Prueba con dos dispositivos** (guion abajo).

### Por qué la función va sin verificación de JWT (y qué lo compensa)
La verificación de Supabase espera un JWT de Supabase Auth. X Money no usa Auth (los usuarios de Auth son del
proyecto entero y x-core es compartido), así que esa verificación rechazaría todo. Lo que lo compensa, todo en
`supabase/functions/xmoney-api/`: token propio HS256 de 30 min con secreto propio (`XMONEY_TOKEN_SECRET`, nunca el
JWT secret de Supabase), validación de firma/expiración/sesión no revocada/cuenta habilitada en cada petición,
refresco rotativo con detección de reutilización, PBKDF2 por cuenta, bloqueo tras 5 fallos y límites por IP y
correo (`xmoney.rate_limits`), registro con código de invitación, CORS restringido, límite de tamaño de petición
(2 MB; 256 KB por registro), consultas siempre parametrizadas, y logs que solo registran acción y estado.

### PBKDF2: iteraciones elegidas
310.000 (SHA-256). Medido en Node local: 210k ≈ 59 ms, 310k ≈ 90 ms, 600k ≈ 167 ms por hash. **No lo medí en la Edge
Function real** (no hay acceso): tras tu primer registro/login revisa el tiempo de CPU en los logs de la función; el
límite es ~2 s y un login hace 1 hash (2 la primera vez que alguien prueba un correo inexistente). Si sobra
holgura, sube `DEFAULT_KDF` en `lib/crypto.ts` (cada cuenta guarda sus parámetros: las existentes siguen validando y
las nuevas contraseñas usan el valor nuevo).

### Plan B (solo si la conexión directa diera problemas)
Si las Edge Functions no pueden usar `SUPABASE_DB_URL` (límite de conexiones o pooler): exponer el schema `xmoney`
en Settings → API y usar `supabase-js` con la service role dentro de la función con `.schema('xmoney')`. Cambia
solo `index.ts` (hay una única interfaz `Db`; hoy `lib/pg-db.ts`). `anon` y `authenticated` deben seguir sin USAGE ni
permisos para que siga cerrado al público; vuelve a correr el script de aislamiento. La service role vive solo en los
secretos de la función, jamás en la app. **Variante dejada: conexión directa.**

## Operación

**Deshabilitar una cuenta** (deja de funcionar al instante, también los tokens ya emitidos):
```sql
update xmoney.accounts set enabled = false where email = 'tu@correo.com';
```
**Cerrar todas las sesiones de una cuenta:**
```sql
update xmoney.sessions set revoked_at = now() where revoked_at is null
  and account_id = (select id from xmoney.accounts where email = 'tu@correo.com');
```
**Restablecer la contraseña por SQL** (perdiste la contraseña Y el código de recuperación): en tu máquina
`node supabase/tools/hash-password.mjs "contraseña nueva de 10+ caracteres" tu@correo.com` imprime el SQL (cambia la
contraseña y revoca las sesiones); pégalo en el editor SQL. Luego entra y regenera el código de recuperación en
Ajustes → Cuenta.
**Rotar el código de invitación:** `supabase secrets set XMONEY_SIGNUP_CODE="<nuevo>"` (o bórralo para desactivar el
registro). No afecta a las cuentas existentes.
**Rotar el secreto del token:** `supabase secrets set XMONEY_TOKEN_SECRET="<nuevo>"`. Los tokens de acceso vigentes
(30 min) dejan de valer; cada dispositivo pide uno nuevo con su token de refresco, así que **no** cierra las
sesiones. Para cerrarlas todas usa el SQL de arriba.
**Borrar los datos de una cuenta en el servidor** (la app nunca lo hace): `delete from xmoney.records where account_id = '<uuid>';`
**Quitar X Money de x-core por completo:** `drop schema xmoney cascade;` y `supabase functions delete xmoney-api`.
**Auditar conflictos/ediciones:** los registros borrados quedan con `deleted_at` y su último `data` (recuperables por SQL).

## IA (2.16.0): pasos para Xaviel

Nada de esto lo aplica ni lo despliega Claude Code. **No pegues la key en chats, commits ni archivos del repo.**

1. **Revisa el historial:** `supabase migration list` (x-core), para no chocar con otras apps. El archivo nuevo es `supabase/migrations/202611041200_xmoney_ai_usage.sql` (crea `xmoney.ai_usage` con RLS y sin permisos para `anon`/`authenticated`; no guarda contenido).
2. **Aplica el SQL** (editor SQL o `supabase db push` tras leerlo). Luego corre `supabase/tests/xmoney_isolation.sql`: ahora también revisa `ai_usage`.
3. **La key de Anthropic:** copia **tú** la misma que ya usan SGC y csd-app (la credencial se reutiliza, los proyectos no) y guárdala como secreto de x-core: `supabase secrets set ANTHROPIC_API_KEY=...`. Escríbela directamente en tu terminal (no desde un archivo del repo) y limpia el historial de la terminal si la dejaste ahí. Como el costo cae en la cuenta del trabajo, los topes de abajo son obligatorios.
4. **Proveedor y modelos (secretos, no están en la app):** `supabase secrets set XMONEY_AI_PROVIDER=anthropic XMONEY_MODEL_FAST=<modelo rápido> XMONEY_MODEL_SMART=<modelo inteligente>`. Los identificadores los eliges tú mirando la documentación del proveedor. Para estimar costos, llena `lib/pricing.ts` con los precios oficiales (sin precio, el costo queda en `null` y solo se registran tokens).
5. **Despliega la función:** `supabase functions deploy xmoney-ai --no-verify-jwt`. Usa `XMONEY_TOKEN_SECRET` y `XMONEY_ALLOWED_ORIGINS` que ya existen. Importa código de `../xmoney-api/lib`: si el despliegue se queja, mueve `tokens.ts`, `crypto.ts`, `db.ts` y `pg-db.ts` a `supabase/functions/_shared/`.
6. **Activa la IA en tu cuenta** (por defecto está apagada) en el editor SQL, cambiando el marcador:
   `update xmoney.accounts set ai_enabled = true where email = '<CORREO_DE_XAVIEL>';`
   Opcional, topes propios: `update xmoney.accounts set monthly_request_cap = 300, monthly_token_cap = 400000 where email = '<CORREO_DE_XAVIEL>';` (sin esto valen 300 solicitudes y 400.000 tokens al mes).
7. **Confirma la URL en la app:** `src/shared/config/app-config.ts` ya apunta a `…/functions/v1/xmoney-api`; la de IA se deriva sola (`…/xmoney-ai`). No va ninguna key en la app.
8. **Prueba:** Ajustes → Inteligencia artificial → enciende el interruptor → «Probar conexión» (muestra primero lo que se enviará: nada de tus datos) → debe decir «La conexión funciona». Revisa el uso del mes en esa misma tarjeta y, si quieres, en SQL: `select feature, model, input_tokens, output_tokens, est_cost_usd, status, latency_ms, created_at from xmoney.ai_usage order by created_at desc limit 20;`
9. **Después del prompt 11 (2.17.0) vuelve a desplegar la función**: la lista blanca creció de 1 a 31 funciones, sin secretos ni SQL nuevos: `supabase functions deploy xmoney-ai --no-verify-jwt`. Sin ese redespliegue, «Probar conexión» sigue funcionando pero las funciones de los módulos responden `bad_request` y la app muestra su texto calculado.
10. **Para apagarla del todo:** `update xmoney.accounts set ai_enabled = false where email = '<CORREO_DE_XAVIEL>';` o `supabase functions delete xmoney-ai`.

## Respaldos: dependes de más de una copia
Este repo no puede ver el plan de Supabase de x-core. **Compruébalo tú** (Dashboard → Database → Backups): los planes
gratuitos no incluyen respaldos automáticos descargables. Si no los hay, tu segunda copia es el respaldo JSON de la app
(recordatorio cada 30 días, configurable en Ajustes) y/o un `pg_dump` periódico del schema `xmoney`.

## Web, PWA e iPhone (Vercel u otro host)
- El host es decisión tuya. `vercel.json` ya trae: reescritura SPA a `index.html`, cabeceras (CSP estricta,
  HSTS, nosniff, referrer, permissions) y caché sin cache para `index.html`/`ngsw*`. **Reemplaza
  `YOUR-PROJECT-REF` en la CSP** (`connect-src`) por la referencia de x-core. Despliega: `vercel --prod` (o conecta el repo).
- **HTTPS obligatorio:** sin él no hay service worker ni instalación en iPhone.
- Añade el dominio web a `XMONEY_ALLOWED_ORIGINS`.
- El service worker **no** cachea la API (`ngsw-config.json` la excluye de la navegación y no define grupos de datos
  para ella): un saldo viejo en pantalla es peor que una página lenta.
- **iPhone (iOS 16.4+, Safari):** Compartir → Añadir a pantalla de inicio. La pestaña de Safari y la PWA instalada
  tienen almacenamiento **separado**: iniciar sesión en una no la inicia en la otra (normal). iOS puede purgar
  IndexedDB de sitios sin uso: la verdad es x-core; lo único que se perdería es lo que no se hubiera sincronizado,
  por eso se sincroniza al abrir, al volver a primer plano y al recuperar red, y Ajustes muestra los cambios pendientes.
  No hay Background Sync ni notificaciones push en esta ronda (las alertas locales de Capacitor no se usan en la web).

## Guion de verificación manual

**Dos dispositivos (p. ej. laptop y Android):**
1. En el dispositivo A crea un movimiento → en B (Ajustes → Sincronizar ahora, o espera ≤ 5 min / vuelve a primer plano) aparece.
2. Pon ambos sin conexión; edita el **mismo** movimiento en A y luego en B (más tarde). Reconecta primero A y luego B.
   Debe ganar la edición de B en los dos; la de A queda en Ajustes → Versiones en conflicto con "Restaurar esta versión".
3. Borra un movimiento en A; en B edítalo después sin conexión; reconecta: el borrado pierde y aparece en Versiones en conflicto.
4. Ajustes → Cuenta → Dispositivos: revoca B desde A. B debe pedir iniciar sesión y conservar sus datos locales.
5. Cambia la contraseña en A: B se desconecta; vuelve a entrar.
6. Recupera con el código de recuperación (cierra sesión → "¿Olvidaste tu contraseña?").

**iPhone real con Safari:** abre la URL → instala con "Añadir a pantalla de inicio" → inicia sesión → activa modo
avión y crea un movimiento → desactívalo y comprueba que sincroniza → cierra la app del todo y reábrela → revisa
safe areas (notch y barra inferior), el teclado al escribir montos, y que Ajustes muestre el aviso de instalación
solo cuando NO estás en modo standalone.

## Lo que esta ronda NO cubre
Verificación de correo, recuperación por correo (no hay infraestructura de correo), autenticación de dos factores,
tiempo real, uso por otras personas.

> **2.18.2:** ya no hace falta activar `ai_enabled` a mano en la base: lo activa el propio usuario desde Ajustes (ver `docs/IA.md`).
