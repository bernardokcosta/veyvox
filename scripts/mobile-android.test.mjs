import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBuildYaml, expectedDesktopAssets } from './desktop-release-assets.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const workflow = (name) => readBuildYaml(read(`.github/workflows/${name}.yml`));

test('mobile package stays in lockstep and Android-only', () => {
  const root = JSON.parse(read('package.json'));
  const mobile = JSON.parse(read('packages/mobile/package.json'));
  assert.equal(mobile.name, '@veyvox/mobile');
  assert.equal(mobile.version, root.version);
  assert.equal(mobile.scripts.test, 'node --test "test/*.test.mjs"');
  const cargo = read('packages/mobile/Cargo.toml');
  assert.match(cargo, new RegExp(`^version = "${mobile.version}"`, 'm'));
  assert.doesNotMatch(cargo, /apple-ios|aarch64-apple|xcode/i);
});

test('release publishes the APK on the same draft before flipping it public', () => {
  const release = workflow('release');
  assert.equal(release.jobs['mobile-apk'].uses, './.github/workflows/mobile-android.yml');
  assert.deepEqual(Object.keys(release.jobs['mobile-apk'].secrets).sort(), [
    'ANDROID_RELEASE_KEYSTORE_BASE64', 'ANDROID_RELEASE_KEYSTORE_PASSWORD',
  ]);
  assert.ok(release.jobs.publish.needs.includes('mobile-apk'));
  const steps = release.jobs.publish.steps.map((step) => step.run ?? step.with?.name ?? '');
  const blob = steps.join('\n');
  assert.ok(blob.includes('android-apk'));
  const draftIndex = steps.findIndex((step) => step.includes('--prepare'));
  const publishIndex = steps.findIndex((step) => step.includes('--publish'));
  assert.ok(draftIndex >= 0 && publishIndex > draftIndex);
  assert.match(steps[publishIndex], /publish-desktop-release\.mjs .*--release-id .*--android-directory android-apk .*--publish/);
  assert.doesNotMatch(blob, /--clobber/);
  assert.doesNotMatch(blob, /gh api .*\/releases\//);
  // Desktop inventory is untouched: still exactly the 16 installer/manifest assets.
  assert.equal(expectedDesktopAssets('1.17.17').length, 16);
  assert.ok(!expectedDesktopAssets('1.17.17').some((name) => name.endsWith('.apk')));
});

test('Docker build stays in sync with the new workspace package', () => {
  const dockerfile = read('Dockerfile');
  assert.ok(dockerfile.includes('COPY packages/shared/package.json packages/shared/'));
  assert.ok(dockerfile.includes('COPY packages/mobile/package.json packages/mobile/'));
  const excludes = read('.dockerignore').split(/\r?\n/);
  assert.ok(excludes.includes('packages/mobile/target'));
  assert.ok(excludes.includes('packages/mobile/dist'));
});

test('mobile spec and platform helper exist with the canonical APK name', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'docs/systems/mobile-native.md')));
  const helper = read('packages/web/src/platform/mobileDownload.ts');
  assert.ok(helper.includes('Veyvox-${version}-android.apk'));
  const check = read('packages/mobile/scripts/check.mjs');
  assert.ok(check.includes('io.github.bernardokcosta.veyvox'));
  const builder = read('packages/mobile/scripts/build-android.mjs');
  for (const step of ["'apk'", "'build'", "'--release'", "'--lib'", 'aapt', 'badging', 'apksigner', 'ANDROID_RELEASE_KEYSTORE_BASE64', 'Veyvox-${pkg.version}-android.apk']) {
    assert.ok(builder.includes(step), step);
  }
  assert.match(builder, /'release', 'apk', 'veyvox_mobile\.apk'/);
  assert.doesNotMatch(builder, /candidates\.sort/);
});
