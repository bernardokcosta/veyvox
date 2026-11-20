import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useVoiceStore } from './voiceStore';

vi.mock('../audio/AudioManager', () => ({ AudioManager: { getInstance: () => ({}) } }));

const KEY = 'backspace-voice-settings';

beforeEach(() => {
  localStorage.clear();
  useVoiceStore.setState(useVoiceStore.getInitialState());
});

describe('screen-share codec persistence', () => {
  it('defaults new profiles to automatic 1080p60 while preserving explicit HEVC', async () => {
    expect(useVoiceStore.getInitialState().screenShareConfig).toMatchObject({ height: 1080, fps: 60, codec: 'auto', customBitrateKbps: null });
    useVoiceStore.getState().setScreenShareConfig({ codec: 'h265' });
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    expect(saved.version).toBe(18);
    expect(saved.state.screenShareConfig.codec).toBe('h265');
    await useVoiceStore.persist.rehydrate();
    expect(useVoiceStore.getState().screenShareConfig.codec).toBe('h265');
  });

  it('keeps the previously saved 720p60 VP9 choice after the upgrade', async () => {
    const config = { ...useVoiceStore.getInitialState().screenShareConfig, height: 720, codec: 'vp9' };
    localStorage.setItem(KEY, JSON.stringify({ version: 17, state: { screenShareConfig: config } }));
    await useVoiceStore.persist.rehydrate();
    expect(useVoiceStore.getState().screenShareConfig).toEqual(config);
  });

  it('gives a version 16 store the default camera config without touching the rest', async () => {
    localStorage.setItem(KEY, JSON.stringify({ version: 16, state: { screenShareConfig: { fps: 120 } } }));
    await useVoiceStore.persist.rehydrate();
    expect(useVoiceStore.getState().cameraConfig).toEqual({ height: 720, fps: 30, customBitrateKbps: null });
    expect(useVoiceStore.getState().screenShareConfig.fps).toBe(120);
  });

  it.each(['vp9', 'h264', 'h265'] as const)('preserves saved %s and unrelated settings from version 15', async (codec) => {
    const previous = {
      ...useVoiceStore.getInitialState().screenShareConfig,
      height: 1080, fps: 120, customBitrateKbps: 9500, shareAudio: true, forceSdr: true, codec,
    };
    localStorage.setItem(KEY, JSON.stringify({ version: 15, state: { screenShareConfig: previous, outputVolume: 75 } }));
    await useVoiceStore.persist.rehydrate();
    expect(useVoiceStore.getState().screenShareConfig).toEqual(previous);
    expect(useVoiceStore.getState().outputVolume).toBe(75);
  });

  it.each([15, 16])('normalizes invalid codec in version %s while preserving other preferences', async (version) => {
    const config = { ...useVoiceStore.getInitialState().screenShareConfig, fps: 120, codec: 'invalid' };
    localStorage.setItem(KEY, JSON.stringify({ version, state: { screenShareConfig: config } }));
    await useVoiceStore.persist.rehydrate();
    expect(useVoiceStore.getState().screenShareConfig).toEqual({ ...config, codec: 'vp9' });
  });

  it('fills missing codec/config fields without losing a stored frame rate', async () => {
    localStorage.setItem(KEY, JSON.stringify({ version: 15, state: { screenShareConfig: { fps: 120 } } }));
    await useVoiceStore.persist.rehydrate();
    expect(useVoiceStore.getState().screenShareConfig).toEqual({
      ...useVoiceStore.getInitialState().screenShareConfig, fps: 120,
    });
  });
});
