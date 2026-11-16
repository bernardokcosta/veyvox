import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { JUNO_COLORS, type JunoFace } from '@veyvox/shared/src/juno';
import { junoCardUrl, JUNO_ASSETS, JUNO_DUBBINGS, resolveJunoDubbing } from './junoAssets';
import { supportedLanguages } from '../../i18n/languages';
import { JUNO_SOUNDS } from './junoSoundCues';

const root = path.resolve(import.meta.dirname, '../../../public/games/juno');
interface Manifest {
  files: { path: string; sha256: string; bytes: number; sourceFile?: string; sourceSha256?: string }[];
  memoryAudio: { path: string; sha256: string; sourceSha256: string; bytes: number; durationSeconds: number };
  intoxicatedAudio: { path: string; sha256: string; sourceSha256: string; bytes: number; durationSeconds: number };
  pizzaAudio: { path: string; sha256: string; sourceSha256: string; bytes: number; durationSeconds: number };
}
describe('supplied Juno asset inventory', () => {
  it('densifies only the supplied edge flour, caps it at 50% and never washes the whole card white', () => {
    const css = readFileSync(path.resolve(import.meta.dirname, 'juno.css'), 'utf8');
    const style = css.match(/\.juno-card-flour\s*\{([^}]+)\}/)?.[1];
    expect(style).not.toMatch(/background(?:-color)?:/);
    expect(style).toMatch(/mask-image:\s*radial-gradient\(ellipse at center,\s*transparent 28%,\s*#000 72%\)/);
    expect(style).toMatch(/filter:\s*(?:drop-shadow\(0 0 0 #faf8ef\)\s*){4}/);
    expect(style).toMatch(/opacity:\s*\.5\s*;/);
  });
  it('ships the supplied pizza, flour and complete pt-BR Vorbis cue with recorded provenance', () => {
    const manifest = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8')) as Manifest;
    expect(manifest.files.find(f => f.path === 'cards/pizza.webp')).toMatchObject({
      sourceFile: 'Pizza Maluca Cósmica.png', sourceSha256: '6f80604b0ae2490fcc4ba079a91003fcf017fee221f721c4e816851d70fc68f4',
    });
    for (const name of ['pizza', 'flour', 'flourParticle', 'flourImpact'] as const) {
      expect(existsSync(path.join(root, JUNO_ASSETS[name].replace('/games/juno/', '')))).toBe(true);
    }
    const audio = manifest.pizzaAudio;
    expect(audio.sourceSha256).toBe('d52f43f3cfa6e12ecb96c5ee9a66d0554284b25efa455fcf16fa2094d2f5cb14');
    expect(audio.durationSeconds).toBeCloseTo(2.2053, 3);
    const bytes = readFileSync(path.resolve(root, '../..', audio.path.slice(1)));
    expect(bytes.subarray(0, 4).toString()).toBe('OggS'); expect(bytes.includes(Buffer.from('vorbis'))).toBe(true);
    expect(bytes.length).toBe(audio.bytes); expect(createHash('sha256').update(bytes).digest('hex')).toBe(audio.sha256);
    expect(Object.keys(JUNO_DUBBINGS)).toEqual(['pt-BR']); expect(JUNO_DUBBINGS['pt-BR'].pizzaSound).toBe('juno_pizza');
  });
  it('preserves Entorpecido source provenance and ships actual WebP/Vorbis media for its dubbing edition', () => {
    const manifest = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8')) as Manifest;
    expect(manifest.files.find(f => f.path === 'cards/intoxicated.webp')).toMatchObject({
      sourceFile: 'Carta neon “Entorpecido” cósmica.png', sourceSha256: '3540e9f0b768b388f25e289fb1d46240c85c40d0e12cc29931c2bdc6111c62fd',
    });
    const audio = manifest.intoxicatedAudio;
    expect(audio.sourceSha256).toBe('035083fbbe809a549d98c846afd097b5d3c576af0dbf169d0f25fa55bb1761a5');
    expect(audio.durationSeconds).toBeGreaterThan(2.2); expect(audio.durationSeconds).toBeLessThan(2.4);
    const bytes = readFileSync(path.resolve(root, '../..', audio.path.slice(1)));
    expect(bytes.subarray(0, 4).toString()).toBe('OggS'); expect(bytes.includes(Buffer.from('vorbis'))).toBe(true);
    expect(bytes.length).toBe(audio.bytes); expect(createHash('sha256').update(bytes).digest('hex')).toBe(audio.sha256);
    expect(JUNO_DUBBINGS['pt-BR'].intoxicatedSound).toBe('juno_intoxicated');
    expect(junoCardUrl({ id: 'not-a-path', color: null, face: 'intoxicated' })).toBe('/games/juno/cards/intoxicated.webp');
  });
  it('ships all 16 unchanged neon Ogg cues with exact hashes and no duplicate formats', () => {
    const sounds = path.resolve(root, '../../sounds/juno');
    const manifest = JSON.parse(readFileSync(path.join(sounds, 'manifest.json'), 'utf8')) as {
      suppliedLicenseStatement: string;
      files: { path: string; sourceFile: string; bytes: number; sha256: string; unchanged: boolean }[];
    };
    expect(manifest.files).toHaveLength(16);
    expect(manifest.suppliedLicenseStatement).toBe('Efeitos criados originalmente para este projeto; não incorporam gravações comerciais.');
    const catalog = Object.values(JUNO_SOUNDS).filter(cue => cue.sound.startsWith('juno/')).map(cue => `${cue.sound.slice(5)}.ogg`).sort();
    expect(manifest.files.map(file => file.path).sort()).toEqual(catalog);
    for (const file of manifest.files) {
      expect(file.path).toMatch(/^[a-z_]+\.ogg$/); expect(file.sourceFile).toBe(`ogg/${file.path}`); expect(file.unchanged).toBe(true);
      const bytes = readFileSync(path.join(sounds, file.path));
      expect(bytes.subarray(0, 4).toString()).toBe('OggS'); expect(bytes.includes(Buffer.from('vorbis'))).toBe(true);
      expect(bytes.length).toBe(file.bytes); expect(createHash('sha256').update(bytes).digest('hex')).toBe(file.sha256);
    }
  });
  it('resolves Automatic dubbing to the only real pt-BR edition for every interface language', () => {
    expect(JUNO_DUBBINGS['pt-BR'].languageCode).toBe('pt');
    for (const { code: language } of supportedLanguages) {
      expect(resolveJunoDubbing('auto', language)).toBe('pt-BR');
      expect(JUNO_DUBBINGS[resolveJunoDubbing('auto', language)].memorySound).toBe('juno_memory');
    }
    expect(resolveJunoDubbing('pt-BR', 'en')).toBe('pt-BR');
  });
  it('ships the original music unchanged, outside the short card/cue inventory', () => {
    const manifest = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8')) as { music: { path: string; sourceFile: string; bytes: number; sha256: string; unchanged: boolean } };
    const music = manifest.music, bytes = readFileSync(path.resolve(root, '../..', music.path.slice(1)));
    expect(music).toMatchObject({ sourceFile: 'Charting_the_Dark.mp3', bytes: 4363065, sha256: '5c1d9c0b04da244f5e55d91340b638bc05469352ce7a3d5cb79d5f115f1912bf', unchanged: true });
    expect(bytes.length).toBe(music.bytes); expect(createHash('sha256').update(bytes).digest('hex')).toBe(music.sha256);
  });
  it('preserves the supplied memory media provenance and serves real Vorbis bytes', () => {
    const manifest = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8')) as Manifest;
    expect(manifest.files.find(f => f.path === 'cards/memory.webp')).toMatchObject({
      sourceFile: 'Carta cósmica da memória nebulosa.png', sourceSha256: '3c8c19c8ff6a0d4a234645993ce35aac5289d12b83eb06135e24a09b97be2f09',
    });
    const audio = manifest.memoryAudio, bytes = readFileSync(path.resolve(root, '../..', audio.path.slice(1)));
    expect(bytes.subarray(0, 4).toString()).toBe('OggS'); expect(bytes.includes(Buffer.from('vorbis'))).toBe(true);
    expect(bytes.length).toBe(audio.bytes); expect(createHash('sha256').update(bytes).digest('hex')).toBe(audio.sha256);
    expect(audio.sourceSha256).toBe('77980fab39415557371636d3bd81c27d6fc3ad7f3361d325bc42eac022584240');
    expect(audio.durationSeconds).toBeGreaterThan(2.7); expect(audio.durationSeconds).toBeLessThan(3);
  });
  it('covers every legal face independently of opaque runtime ids', () => {
    const faces: JunoFace[] = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'skip', 'reverse', 'draw2'];
    for (const color of JUNO_COLORS) for (const face of faces) expect(existsSync(path.join(root, junoCardUrl({ id: 'not-a-path', color, face }).replace('/games/juno/', '')))).toBe(true);
    for (const face of ['wild', 'draw4', 'memory', 'intoxicated', 'pizza'] as const) expect(existsSync(path.join(root, junoCardUrl({ id: 'opaque', color: null, face }).replace('/games/juno/', '')))).toBe(true);
    expect(junoCardUrl()).toBe('/games/juno/cards/back.webp');
  });
  it('ships the approved original hammer and its separate resting crop', () => {
    const original = readFileSync(path.join(root, JUNO_ASSETS.hammer.replace('/games/juno/', '')));
    expect(createHash('sha256').update(original).digest('hex')).toBe('782e92bc0e255568f8001b0af6eb6f542a7d849d4390ea117daeacd3e4f25db2');
    expect(existsSync(path.join(root, JUNO_ASSETS.hammerStill.replace('/games/juno/', '')))).toBe(true);
  });
  it('ships 57 original faces and one back, all hashed and passive', () => {
    const manifest = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8')) as Manifest;
    const cards = manifest.files.filter(file => file.path.startsWith('cards/'));
    expect(cards).toHaveLength(58); expect(cards.some(f => f.path === 'cards/back.webp')).toBe(true);
    expect(new Set(manifest.files.map(f => f.path)).size).toBe(manifest.files.length);
    for (const file of manifest.files) {
      expect(file.path).not.toMatch(/\.\.|preview|previa|demo|\.png$/i);
      expect(existsSync(path.join(root, file.path))).toBe(true);
      const data = readFileSync(path.join(root, file.path));
      expect(data.length).toBe(file.bytes); expect(createHash('sha256').update(data).digest('hex')).toBe(file.sha256);
      if (file.path.endsWith('.svg')) expect(data.toString()).not.toMatch(/<script|\bon\w+\s*=|(?:href|src)=["'](?:https?:|data:|javascript:)/i);
    }
  });
});
