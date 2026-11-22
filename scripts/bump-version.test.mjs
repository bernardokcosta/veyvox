import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { updateRustVersion } from './bump-version.mjs';

async function sandbox(t, eol = '\n') {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'veyvox-bump-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.mkdir(path.join(dir, 'packages/mobile'), { recursive: true });
  const join = (lines) => lines.join(eol) + eol;
  await fs.writeFile(
    path.join(dir, 'packages/mobile/Cargo.toml'),
    join([
      '[package]',
      'name = "veyvox-mobile"',
      'version = "1.17.17"',
      'edition = "2021"',
      '',
      '[dependencies]',
      'egui = "0.32"',
    ]),
  );
  await fs.writeFile(
    path.join(dir, 'packages/mobile/Cargo.lock'),
    join([
      '# header',
      '[[package]]',
      'name = "other"',
      'version = "0.1.0"',
      '',
      '[[package]]',
      'name = "veyvox-mobile"',
      'version = "1.17.17"',
      'dependencies = [',
      ' "egui",',
      ']',
    ]),
  );
  return dir;
}

async function apply(t, eol = '\n') {
  const dir = await sandbox(t, eol);
  const pending = await updateRustVersion(dir, '1.17.18');
  assert.equal(pending.length, 2);
  for (const [file, updated] of pending) await fs.writeFile(file, updated);
  return dir;
}

test('bump updates the Rust manifests in lockstep', async (t) => {
  const dir = await apply(t);
  const cargo = await fs.readFile(path.join(dir, 'packages/mobile/Cargo.toml'), 'utf8');
  assert.match(cargo, /^version = "1.17.18"$/m);
  assert.ok(cargo.includes('egui = "0.32"'));
  const lock = await fs.readFile(path.join(dir, 'packages/mobile/Cargo.lock'), 'utf8');
  assert.ok(lock.includes('name = "veyvox-mobile"\nversion = "1.17.18"'));
  assert.ok(lock.includes('name = "other"\nversion = "0.1.0"'));
});

test('bump preserves CRLF checkouts instead of diverging', async (t) => {
  const dir = await apply(t, '\r\n');
  const cargo = await fs.readFile(path.join(dir, 'packages/mobile/Cargo.toml'), 'utf8');
  assert.match(cargo, /^version = "1.17.18"$/m);
  assert.ok(cargo.includes('\r\n'));
  const lock = await fs.readFile(path.join(dir, 'packages/mobile/Cargo.lock'), 'utf8');
  assert.ok(lock.includes('name = "veyvox-mobile"\r\nversion = "1.17.18"'));
  assert.ok(lock.includes('name = "other"\r\nversion = "0.1.0"'));
});

test('bump refuses a missing Cargo.lock instead of drifting', async (t) => {
  const dir = await sandbox(t);
  await fs.unlink(path.join(dir, 'packages/mobile/Cargo.lock'));
  await assert.rejects(updateRustVersion(dir, '1.17.18'), /Cargo\.lock is missing/);
});
