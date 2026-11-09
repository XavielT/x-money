// The version of THIS build, shown in Settings and compared with the latest release by the update button.
// Keep it equal to `versionName` in android/app/build.gradle (CLAUDE.md, "Versión").
export const APP_VERSION = '2.22.0';

// Where the Android app finds its next version: the public GitHub releases of the project. The APK URL is built
// here, never taken from what the network says, so a reply can only ever point to this repository.
export const RELEASES_REPO = 'XavielT/x-money';
export const APK_URL = `https://github.com/${RELEASES_REPO}/releases/latest/download/x-money.apk`;
export const LATEST_RELEASE_API = `https://api.github.com/repos/${RELEASES_REPO}/releases/latest`;
