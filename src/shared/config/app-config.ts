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
