/**
 * Android APK download links for the 100% Rust native client.
 *
 * Pure and dependency-free, mirroring `desktopDownload.ts`: the version
 * arrives as an argument so the module runs the same in a test as in the
 * browser. The APK is Android-only; there is no iOS build.
 */

export interface MobileDownload {
  os: 'android';
  /** One universal APK carries arm64 (phones), 32-bit ARM and x86_64 (emulator). */
  arch: 'universal';
  kind: 'apk';
  filename: string;
  url: string;
}

export const MOBILE_RELEASES_URL =
  'https://github.com/bernardokcosta/veyvox/releases';

const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

/** Canonical APK name, in step with `packages/mobile/scripts/build-android.mjs` and `mobile-android.yml`. */
export function androidApkFilename(version: string): string {
  return `Veyvox-${version}-android.apk`;
}

/** Turns an instance version into the APK offer. */
export function buildMobileDownload(version: string): MobileDownload {
  const versionIsReleasable = VERSION_PATTERN.test(version);
  const filename = androidApkFilename(version);
  return {
    os: 'android',
    arch: 'universal',
    kind: 'apk',
    filename,
    url: versionIsReleasable
      ? `${MOBILE_RELEASES_URL}/download/v${version}/${filename}`
      : MOBILE_RELEASES_URL,
  };
}
