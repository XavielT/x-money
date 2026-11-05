# Preparar la captura inteligente (pasos de Xaviel)

Claude Code **no** aplica SQL, no despliega a producción por su cuenta ni toca secretos sin que lo pidas. Todo
esto es opcional: sin él, la captura de imágenes/PDF/texto funciona con la IA (paso 1) y el correo queda apagado.

## 1. Captura de imágenes, PDF, texto y voz (usa `xmoney-ai`)

1. La función `xmoney-ai` ya tiene la clave de Anthropic y los topes (`docs/SETUP-XCORE.md`). Esta ronda
   **agrega** `capture_parse` a su lista blanca → hay que **redesplegar** `xmoney-ai`:
   `supabase functions deploy xmoney-ai --no-verify-jwt --project-ref <ref de x-core>`
2. Define el modelo con visión (el servidor lo fija, el cliente no): `XMONEY_MODEL_SMART` (y, si quieres precios
   para el tope de costo, los de `lib/pricing.ts`). Sin precios el tope de costo no se activa; los topes de
   solicitudes y de 40 capturas diarias sí.
3. Opcional: `XMONEY_CAPTURE_COST_CAP_USD` cambia el tope mensual de costo (5 US$ por defecto, solo cuenta llamadas
   con precio conocido).
4. Instala el APK 2.18.0, Ajustes → «Captura inteligente» → encender (consentimiento) y sigue el guion de
   `docs/CAPTURA.md`.

## 2. Leer el correo (Gmail, solo lectura) — opcional

El código está completo y **apagado**. Para encenderlo:

### 2.1 Google Cloud
1. En <https://console.cloud.google.com> crea un proyecto (p. ej. «x-money-mail»).
2. *APIs y servicios → Biblioteca*: habilita **Gmail API**.
3. *Pantalla de consentimiento de OAuth*: tipo **Externo**, nombre de la app, tu correo como contacto. Alcance:
   `https://www.googleapis.com/auth/gmail.readonly` (solo ese). Agrega **tu correo como usuario de prueba**.
4. *Credenciales → Crear credenciales → ID de cliente de OAuth*: tipo **Aplicación web**. URI de redirección
   autorizado: `https://<ref de x-core>.supabase.co/functions/v1/xmoney-mail/callback`.
5. Guarda el ID y el secreto del cliente (no los pegues en el chat ni en el repo).

### 2.2 Para no reconectar cada 7 días: publica la app («In production»)
- Según la documentación de OAuth 2.0 de Google (verificada el 04/11/2026), un proyecto **Externo** en estado
  **«Testing»** recibe un token de refresco que **caduca a los 7 días**. Esa es la causa: no es del código de X Money.
- La salida práctica para **una sola cuenta personal**: en *Pantalla de consentimiento de OAuth* pulsa **«Publicar
  la aplicación»** (estado «In production»). Sin pedir verificación, Google mostrará la pantalla «Google no ha
  verificado esta aplicación» **una vez** (Avanzado → «Ir a X Money (no seguro)») y limita la app a 100 usuarios
  nuevos (documentación de Google sobre apps no verificadas, verificada hoy): para ti solo no importa.
- Lo que **no** pude verificar en la documentación: que en estado «In production» sin verificar el token deje de
  caducar a los 7 días (la página de apps no verificadas no habla de la vida del token). La regla documentada de los 7 días
  es la de «Testing», así que debería desaparecer, pero confírmalo en la práctica: si la conexión volviera a
  caducar, la app lo avisa («La conexión venció… Conecta de nuevo») y reconectar es un toque.
- `gmail.readonly` es un alcance **restringido**; la verificación completa (y su evaluación de seguridad) solo
  hace falta para publicar la app a otras personas.
- Si tu correo es de una organización (Workspace), el administrador puede restringir el acceso (`admin_policy_enforced`).

### 2.3 Supabase (x-core)
1. Aplica `supabase/migrations/202611051200_xmoney_mail_connections.sql` (tabla `xmoney.mail_connections`, el
   token se guarda **cifrado**).
2. Secretos (tú, a mano; nunca en el repo ni en el chat):
   ```
   supabase secrets set XMONEY_MAIL_KEY=<32 bytes aleatorios en base64url>
   supabase secrets set GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=...
   supabase secrets set XMONEY_MAIL_REDIRECT=https://<ref>.supabase.co/functions/v1/xmoney-mail/callback
   ```
   Para generar `XMONEY_MAIL_KEY`: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`.
   **Si pierdes o cambias esta clave** los tokens guardados ya no se pueden abrir: solo hay que reconectar.
3. Despliega: `supabase functions deploy xmoney-mail --no-verify-jwt` (X Money tiene sus propias cuentas y tokens,
   igual que `xmoney-api`).
   Al terminar en Google, la función **redirige** a una página del sitio de X Money (`/mail-connected`, `/mail-expired`,
   `/mail-failed`; carpeta `site/`, proyecto Vercel `x-money-site`). No sirve HTML propio: Supabase lo entrega como texto plano.
   La dirección base se cambia con el secreto opcional `XMONEY_MAIL_DONE_URL`.
4. En la app: Ajustes → «Captura inteligente» → «Leer mi correo (Gmail)» → lista los remitentes de **tus**
   bancos (la app **no** inventa direcciones; la lista empieza vacía) → «Conectar Gmail» → «Buscar en mi correo».

### 2.4 Cómo se lee
- Solo mensajes de los remitentes que listes, posteriores a la fecha de conexión y a un cursor; máximo 30 por
  búsqueda; nunca se recorre el resto del buzón. Si la dirección real del remitente no coincide con tu lista (un
  «From» falsificado), el mensaje no genera borrador.
- El servidor devuelve texto reducido (sin HTML, firmas, pies, enlaces ni correos) y **no lo guarda**; el
  dispositivo lo envía por el mismo camino de captura (interruptor, consentimiento y topes).
- Sin tareas programadas: corre al abrir la app (solo si el interruptor del correo está encendido) y con el botón.
  Si quieres programarlo con `pg_cron`, es una opción que **no** está activada ni documentada paso a paso aquí.
- Desconectar borra el token cifrado y lo revoca en Google.

## 3. Otros proveedores de correo
Detrás de la interfaz `MailProvider` (`supabase/functions/xmoney-mail/lib/provider.ts`) solo existe Gmail. IMAP,
Microsoft u otros **no están cubiertos** (sin contraseñas de aplicación en esta ronda).

## 4. Apagar todo
Ajustes → «Captura inteligente» → apagar (retira el consentimiento). Para el correo: «Desconectar». En el servidor:
quita `ANTHROPIC_API_KEY` o `GOOGLE_CLIENT_*` y la función responde «no configurada».
