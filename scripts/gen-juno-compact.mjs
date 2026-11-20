// Regenerate the offline responsive renditions. The approved originals stay untouched.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const root = path.resolve(import.meta.dirname, '../packages/web/public/games/juno');
const width = 288;
const options = { quality: 90, alphaQuality: 100 };
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const original = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
const cards = original.files.filter(({ path: file }) => /^cards\/[a-z0-9-]+\.webp$/.test(file) || file === 'ui/flour.webp');
const files = [];

for (const item of cards) {
  const input = await readFile(path.join(root, item.path));
  if (hash(input) !== item.sha256) throw new Error(`Juno original does not match the manifest: ${item.path}`);
  const image = sharp(input);
  const { format, width: originalWidth, height } = await image.metadata();
  if (format !== 'webp' || originalWidth !== 720 || height !== 1056) {
    throw new Error(`Juno original does not have the expected format and dimensions: ${item.path}`);
  }
  const data = await image.resize({ width, withoutEnlargement: true }).webp(options).toBuffer();
  if (data.length >= input.length * .8) throw new Error(`Compact rendition does not save 20%: ${item.path}`);
  const output = `compact/${item.path}`;
  const destination = path.join(root, output);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, data);
  files.push({ source: item.path, sourceSha256: item.sha256, path: output, bytes: data.length, sha256: hash(data) });
}

await writeFile(path.join(root, 'compact/manifest.json'), `${JSON.stringify({ width, options, files }, null, 2)}\n`);
console.log(`Generated ${files.length} compact Juno WebP assets.`);
