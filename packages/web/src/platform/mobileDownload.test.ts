import { describe, it, expect } from 'vitest';
import { buildMobileDownload, androidApkFilename, MOBILE_RELEASES_URL } from './mobileDownload';

describe('mobileDownload', () => {
  it('names the canonical Android APK', () => {
    expect(androidApkFilename('1.17.17')).toBe('Veyvox-1.17.17-android.apk');
  });

  it('points at the tagged asset for releasable versions', () => {
    const download = buildMobileDownload('1.17.17');
    expect(download).toEqual({
      os: 'android',
      arch: 'universal',
      kind: 'apk',
      filename: 'Veyvox-1.17.17-android.apk',
      url: `${MOBILE_RELEASES_URL}/download/v1.17.17/Veyvox-1.17.17-android.apk`,
    });
  });

  it('falls back to the releases listing for dev versions', () => {
    const download = buildMobileDownload('0.0.0-dev');
    expect(download.url).toBe(MOBILE_RELEASES_URL);
    expect(download.filename).toBe('Veyvox-0.0.0-dev-android.apk');
  });
});
