/* global Response */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { releaseFixture } from './fixtures/desktop-release.mjs';
import { validateDesktopRelease } from './desktop-release-assets.mjs';
import { createGitHubReleaseApi, prepareDesktopRelease, publishDesktopRelease } from './publish-desktop-release.mjs';

const COMMIT = 'a'.repeat(40);
async function fixture(t) {
  const directory = await releaseFixture(t); const notesPath = path.join(path.dirname(directory), path.basename(directory) + '-notes.md');
  await fs.writeFile(notesPath, '# Veyvox 1.15.1\n\nSynthetic release notes with a complete summary and explicit acceptance limitations for these local HTTP fixture tests.\n');
  t.after(() => fs.unlink(notesPath));
  const androidDirectory = `${directory}-android`;
  const apkName = 'Veyvox-1.15.1-android.apk';
  const apkPath = path.join(androidDirectory, apkName);
  const apkBytes = 'synthetic APK bytes';
  const apkDigest = createHash('sha256').update(apkBytes).digest('hex');
  await fs.mkdir(androidDirectory);
  t.after(() => fs.rm(androidDirectory, { recursive: true, force: true }));
  await fs.writeFile(apkPath, apkBytes);
  await fs.writeFile(`${apkPath}.sha256`, `${apkDigest}  ${apkName}\n`);
  const state = { releases: [], assets: [], uploads: 0, publishes: 0, failUpload: false, commit: COMMIT };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://fixture'); const route = url.pathname.replace('/repos/bernardokcosta/veyvox', '');
    const chunks = []; for await (const chunk of req) chunks.push(chunk); const bytes = Buffer.concat(chunks);
    let result;
    if (route === '/commits/v1.15.1') result = { sha: state.commit };
    else if (route === '/releases' && req.method === 'GET') result = state.releases;
    else if (route === '/releases' && req.method === 'POST') { result = { ...JSON.parse(bytes), id: 42 }; state.releases.push(result); }
    else if (route === '/releases/42' && req.method === 'GET') result = state.releases.find((item) => item.id === 42);
    else if (route === '/releases/42' && req.method === 'PATCH') { state.publishes++; result = Object.assign(state.releases[0], JSON.parse(bytes)); }
    else if (route === '/releases/42/assets' && req.method === 'GET') result = state.assets;
    else if (route === '/releases/42/assets' && req.method === 'POST') {
      state.uploads++;
      if (state.failUpload && state.uploads === 4) { res.writeHead(503).end(); return; }
      result = { id: 100 + state.assets.length, name: url.searchParams.get('name'), size: bytes.length, digest: 'sha256:' + createHash('sha256').update(bytes).digest('hex') };
      state.assets.push(result);
    } else { res.writeHead(404).end(); return; }
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(result));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const api = createGitHubReleaseApi({ token: 'synthetic-test-token', fetch: (url, options) => {
    const original = new URL(url);
    const isUpload = options.method === 'POST' && original.pathname.endsWith('/assets');
    assert.equal(original.hostname, isUpload ? 'uploads.github.com' : 'api.github.com');
    return fetch(`http://127.0.0.1:${server.address().port}${original.pathname}${original.search}`, options);
  } });
  const options = { repository: 'bernardokcosta/veyvox', tag: 'v1.15.1', commit: COMMIT, notesPath, directory, androidDirectory,
    inventory: await validateDesktopRelease(directory, '1.15.1'), releaseId: 42, publish: true };
  return { options, state, api, apkPath, apkName, apkBytes };
}

test('one id-aware writer verifies exact bytes and reruns without replacing public assets', async (t) => {
  const { options, state, api } = await fixture(t);
  assert.equal(await prepareDesktopRelease(options, api), 42);
  await publishDesktopRelease(options, api);
  assert.equal(state.assets.length, 17); assert.equal(state.uploads, 17); assert.equal(state.publishes, 1);
  await publishDesktopRelease(options, api);
  assert.equal(state.uploads, 17); assert.equal(state.publishes, 1);
});

test('upload failure leaves a draft and a retry resumes the same release id', async (t) => {
  const { options, state, api } = await fixture(t); await prepareDesktopRelease(options, api);
  state.failUpload = true; await assert.rejects(publishDesktopRelease(options, api));
  assert.equal(state.releases[0].draft, true); assert.equal(state.publishes, 0);
  assert.equal(state.assets.length, 3);
  state.failUpload = false; await publishDesktopRelease({ ...options, publish: false }, api);
  assert.equal(state.assets.length, 17); assert.equal(state.releases[0].draft, true);
  await publishDesktopRelease(options, api); assert.equal(state.publishes, 1);
});

test('rejects ambiguous releases, wrong identity/commit/id and moved tags without writes', async (t) => {
  const { options, state, api } = await fixture(t); await prepareDesktopRelease(options, api);
  for (const overrides of [{ repository: 'other/project' }, { tag: 'v1.15.0' }, { commit: 'b'.repeat(40) }, { releaseId: 99 }]) {
    await assert.rejects(publishDesktopRelease({ ...options, ...overrides }, api));
  }
  state.releases.push({ ...state.releases[0], id: 43 });
  await assert.rejects(prepareDesktopRelease(options, api), /ambiguous|multiple/i);
  await assert.rejects(publishDesktopRelease(options, api)); state.releases.pop();
  state.commit = 'b'.repeat(40); await assert.rejects(publishDesktopRelease(options, api));
  assert.equal(state.uploads, 0); assert.equal(state.publishes, 0);
});

test('never overwrites conflicting assets, edited notes or unrelated untagged drafts', async (t) => {
  const { options, state, api } = await fixture(t); await prepareDesktopRelease(options, api);
  const unrelated = { id: 9, tag_name: 'untagged-preserved', draft: true, body: 'User work' }; state.releases.push(unrelated);
  state.assets.push({ id: 1, name: options.inventory.assets[0].name, size: 1, digest: 'sha256:' + 'b'.repeat(64) });
  await assert.rejects(publishDesktopRelease(options, api), /different|mismatch/i); assert.equal(state.uploads, 0);
  state.assets = []; state.releases[0].body = 'User-edited notes';
  await assert.rejects(publishDesktopRelease(options, api), /notes/i);
  assert.equal(state.publishes, 0); assert.deepEqual(state.releases[1], unrelated);
});

test('the checked Android APK is uploaded to the same draft without breaking reruns', async (t) => {
  const { options, state, api, apkName } = await fixture(t); await prepareDesktopRelease(options, api);
  await publishDesktopRelease({ ...options, publish: false }, api);
  assert.equal(state.assets.length, 17);
  assert.equal(state.assets.at(-1).name, apkName);
  assert.equal(state.releases[0].draft, true);
  const result = await publishDesktopRelease(options, api);
  assert.equal(result.assets, 17);
  assert.equal(state.releases[0].draft, false);
  // A rerun finds everything in place and changes nothing.
  const rerun = await publishDesktopRelease(options, api);
  assert.equal(rerun.assets, 17);
  assert.equal(state.uploads, 17);
  // Anything else extra is still refused.
  state.assets.push({ id: 201, name: 'unexpected-binary.bin', size: 8, digest: 'sha256:' + 'd'.repeat(64) });
  await assert.rejects(publishDesktopRelease(options, api), /unexpected/i);
});

test('missing, locally tampered, or remotely mismatched Android APK never makes the draft public', async (t) => {
  const { options, state, api, apkPath } = await fixture(t); await prepareDesktopRelease(options, api);
  await assert.rejects(publishDesktopRelease({ ...options, androidDirectory: undefined }, api), /Android APK directory/i);
  await fs.writeFile(apkPath, 'tampered');
  await assert.rejects(publishDesktopRelease(options, api), /Android APK.*digest/i);
  assert.equal(state.uploads, 0);
  assert.equal(state.publishes, 0);
  assert.equal(state.releases[0].draft, true);
});

test('a wrong or missing remote Android APK prevents public transition even after upload', async (t) => {
  const { options, state, api, apkName } = await fixture(t); await prepareDesktopRelease(options, api);
  for (const remove of [false, true]) {
    state.assets = [];
    const altered = {
      ...api,
      listAssets: async (...args) => (await api.listAssets(...args)).flatMap((asset) => {
        if (asset.name !== apkName) return [asset];
        return remove ? [] : [{ ...asset, digest: `sha256:${'0'.repeat(64)}` }];
      }),
    };
    await assert.rejects(publishDesktopRelease(options, altered), /different bytes|incomplete remote/i);
    assert.equal(state.publishes, 0);
    assert.equal(state.releases[0].draft, true);
  }
});

test('digest fallback verifies bytes without forwarding authorization to signed CDN redirects', async () => {
  const seen = [];
  const api = createGitHubReleaseApi({ token: 'synthetic-test-token', fetch: async (url, options) => {
    seen.push({ host: new URL(url).hostname, authorization: options.headers.Authorization });
    return seen.length === 1 ? new Response(null, { status: 302, headers: { location: 'https://release-assets.githubusercontent.com/test?signature=synthetic' } })
      : new Response('ok');
  } });
  const digest = await api.assetDigest('bernardokcosta/veyvox', { id: 1, size: 2 });
  assert.equal(digest.sha256, createHash('sha256').update('ok').digest('hex'));
  assert.deepEqual(seen, [{ host: 'api.github.com', authorization: 'Bearer synthetic-test-token' }, { host: 'release-assets.githubusercontent.com', authorization: undefined }]);
  let calls = 0;
  const unsafe = createGitHubReleaseApi({ token: 'synthetic-test-token', fetch: async () => {
    calls++; return new Response(null, { status: 302, headers: { location: 'https://foreign.test/exfiltrate' } });
  } });
  await assert.rejects(unsafe.assetDigest('bernardokcosta/veyvox', { id: 1, size: 2 }), /untrusted/i);
  assert.equal(calls, 1);
});
