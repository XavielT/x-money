// "Is there a newer version?" for the Android app, from the reply of the GitHub releases API. Pure.
// A version is X.Y.Z (a leading "v" is allowed). Anything that does not parse is never "newer": a strange reply
// can only ever mean "no update", never an update to something unexpected.
export type Version = readonly [number, number, number];

export function parseVersion(text: unknown): Version | null {
  if (typeof text !== 'string') return null;
  const m = /^v?(\d{1,4})\.(\d{1,4})\.(\d{1,4})$/.exec(text.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

export function compareVersions(a: Version, b: Version): number {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return 0;
}

export const isNewerVersion = (latest: unknown, current: string): boolean => {
  const l = parseVersion(latest);
  const c = parseVersion(current);
  return !!l && !!c && compareVersions(l, c) > 0;
};

export interface LatestRelease {
  version: string; // "2.20.7"
  hasApk: boolean; // the release carries the stable x-money.apk asset
}

// Reads the reply of GET /repos/<repo>/releases/latest; a draft or a pre-release is never "the latest version"
export function latestReleaseOf(json: unknown): LatestRelease | null {
  if (!json || typeof json !== 'object') return null;
  const r = json as Record<string, unknown>;
  if (r['draft'] === true || r['prerelease'] === true) return null;
  const v = parseVersion(r['tag_name']);
  if (!v) return null;
  const assets = Array.isArray(r['assets']) ? r['assets'] : [];
  const hasApk = assets.some((a) => !!a && typeof a === 'object' && (a as Record<string, unknown>)['name'] === 'x-money.apk');
  return { version: v.join('.'), hasApk };
}
