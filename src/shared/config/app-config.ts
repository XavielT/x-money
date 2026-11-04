// Backend wiring. Xaviel sets apiUrl once the xmoney-api function is deployed
// (docs/SETUP-XCORE.md): the URL of the function, e.g.
//   https://<project-ref>.supabase.co/functions/v1/xmoney-api
// It is NOT a secret and there is no key here: the app only talks to that function.
// While it is empty the app runs in local-only mode (no login, no sync), exactly
// like 2.5.x, so nothing breaks before the backend exists.
export const APP_CONFIG = {
  apiUrl: 'https://nakgrkcqyuycadeuenuw.supabase.co/functions/v1/xmoney-api',
};

export const isSyncConfigured = (): boolean => /^https?:\/\//.test(APP_CONFIG.apiUrl);

// The AI function lives next to xmoney-api in the same project: same host, other function name.
// Still no key here: the provider key is a secret of that function (docs/SETUP-XCORE.md).
export const aiUrl = (apiUrl: string = APP_CONFIG.apiUrl): string => apiUrl.replace(/\/+$/, '').replace(/\/xmoney-api$/, '/xmoney-ai');

// The Gmail connector of smart capture (2.18.0): same host, other function. Secrets live in that function.
export const mailUrl = (apiUrl: string = APP_CONFIG.apiUrl): string => apiUrl.replace(/\/+$/, '').replace(/\/xmoney-api$/, '/xmoney-mail');
