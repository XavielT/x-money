export const APP_AND_DEV_ORIGINS = ['capacitor://localhost', 'https://localhost', 'http://localhost:4200', 'http://localhost:4300'];

export function allowedOrigins(extra: string | undefined): Set<string> {
  return new Set([
    ...APP_AND_DEV_ORIGINS,
    ...(extra ?? '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
  ]);
}

export function corsHeaders(origin: string | null, allowed: Set<string>): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'Origin' };
  if (origin && allowed.has(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Headers'] = 'authorization, content-type';
    headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
    headers['Access-Control-Max-Age'] = '600';
  }
  return headers;
}
