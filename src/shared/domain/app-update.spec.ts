// "Is there a newer version?" The Android app asks GitHub; a strange reply must only ever mean "no update".
import { describe, expect, it } from 'vitest';
import { compareVersions, isNewerVersion, latestReleaseOf, parseVersion } from './app-update';

describe('versions', () => {
  it('parses X.Y.Z with or without the v', () => {
    expect(parseVersion('2.20.6')).toEqual([2, 20, 6]);
    expect(parseVersion('v2.20.6')).toEqual([2, 20, 6]);
    expect(parseVersion(' v10.0.1 ')).toEqual([10, 0, 1]);
  });

  it.each(['', 'v2.20', '2.20.6.1', 'latest', '2.x.6', 'v2.20.6-beta', undefined, null, 5, {}])('%s is not a version', (v) => expect(parseVersion(v)).toBeNull());

  it('compares numbers, not text: 2.20.10 is newer than 2.20.9 and 2.9.0 is older than 2.20.0', () => {
    expect(compareVersions([2, 20, 10], [2, 20, 9])).toBe(1);
    expect(compareVersions([2, 9, 0], [2, 20, 0])).toBe(-1);
    expect(compareVersions([2, 20, 6], [2, 20, 6])).toBe(0);
    expect(compareVersions([3, 0, 0], [2, 99, 99])).toBe(1);
  });

  it('only a parsable, strictly newer version is an update', () => {
    expect(isNewerVersion('v2.20.7', '2.20.6')).toBe(true);
    expect(isNewerVersion('v2.20.6', '2.20.6')).toBe(false);
    expect(isNewerVersion('v2.20.5', '2.20.6')).toBe(false);
    expect(isNewerVersion('garbage', '2.20.6')).toBe(false);
    expect(isNewerVersion('v9.9.9', 'not-a-version')).toBe(false);
  });
});

describe('latestReleaseOf (the reply of GET /releases/latest)', () => {
  const asset = (name: string) => ({ name, browser_download_url: 'https://example.invalid/x' });

  it('reads the version and whether the APK is attached', () => {
    expect(latestReleaseOf({ tag_name: 'v2.20.7', assets: [asset('x-money.apk'), asset('x-money-2.20.7-release.apk')] })).toEqual({ version: '2.20.7', hasApk: true });
    expect(latestReleaseOf({ tag_name: 'v2.20.7', assets: [asset('notes.txt')] })).toEqual({ version: '2.20.7', hasApk: false });
    expect(latestReleaseOf({ tag_name: 'v2.20.7' })).toEqual({ version: '2.20.7', hasApk: false });
  });

  it('a draft, a pre-release or a reply that is not a release is never the latest version', () => {
    expect(latestReleaseOf({ tag_name: 'v2.20.7', draft: true, assets: [asset('x-money.apk')] })).toBeNull();
    expect(latestReleaseOf({ tag_name: 'v2.20.7', prerelease: true, assets: [asset('x-money.apk')] })).toBeNull();
    expect(latestReleaseOf({ tag_name: 'nightly' })).toBeNull();
    expect(latestReleaseOf({ message: 'Not Found' })).toBeNull();
    expect(latestReleaseOf(null)).toBeNull();
    expect(latestReleaseOf('<html>')).toBeNull();
  });
});
