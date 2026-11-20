import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RateLimitError } from '../../api/client';
import { useAuthStore } from '../../stores/authStore';
import { useJunoStore } from '../../stores/junoStore';
import { useSpaceStore } from '../../stores/spaceStore';
import { useVoiceStore } from '../../stores/voiceStore';
import { JunoSession } from './JunoSession';
import { junoGame, junoUser } from './junoTestFixtures';

const get = vi.hoisted(() => vi.fn());
vi.mock('../../api/client', async original => ({ ...await original<typeof import('../../api/client')>(), api: { juno: { get } } }));
vi.mock('../../audio/AudioManager', () => ({ AudioManager: { getInstance: () => ({}) } }));
vi.mock('./JunoMusic', () => ({ JunoMusic: () => null }));
vi.mock('./JunoSounds', () => ({ JunoSounds: () => null }));
const target = { userId: 'viewer', channelId: 'voice', origin: window.location.origin };
let visibility: DocumentVisibilityState;
const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const update = (fn: () => void) => act(async () => { fn(); });

beforeEach(() => {
  vi.useFakeTimers();
  visibility = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  get.mockReset().mockResolvedValue({ revision: 1, game: null });
  useJunoStore.getState().reset();
  useJunoStore.setState({ supported: true });
  useAuthStore.setState({ user: junoUser(target.userId) });
  useSpaceStore.setState({ spaceChannelIndex: new Map([['voice', { spaceId: 'space', type: 'voice' }]]) });
  useVoiceStore.setState({ currentVoiceChannelId: 'voice', isLiveKitConnected: true, voiceConnectionStatus: 'connected' });
});
afterEach(() => {
  cleanup();
  useJunoStore.getState().reset();
  useJunoStore.setState({ supported: false });
  useAuthStore.setState({ user: null });
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('Juno session safety refresh', () => {
  it('reads immediately on entry but only every thirty seconds in a passive voice session', async () => {
    render(<JunoSession />);
    await tick(29_999);
    expect(get).toHaveBeenCalledTimes(1);
    await tick(1);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('uses actual table presence even if open stays true when switching to text', async () => {
    render(<JunoSession />);
    await update(() => useJunoStore.getState().setOpen(true));
    let release!: () => void;
    await update(() => { release = useJunoStore.getState().presentView(target); });
    get.mockClear();
    await tick(5_000);
    expect(get).toHaveBeenCalledTimes(1);
    await update(release);
    expect(useJunoStore.getState().open).toBe(true);
    await tick(5_000);
    expect(get).toHaveBeenCalledTimes(1);
    await update(() => { release = useJunoStore.getState().presentView(target); });
    await tick(5_000);
    expect(get).toHaveBeenCalledTimes(3);
    await update(release);
  });

  it('keeps a minimized seated player on the five-second cadence but skips a freshly confirmed read', async () => {
    useAuthStore.setState({ user: junoUser('a') });
    get.mockResolvedValue({ revision: 1, game: junoGame('playing') });
    render(<JunoSession />);
    await tick(4_000);
    await update(() => useJunoStore.getState().invalidate('voice'));
    expect(get).toHaveBeenCalledTimes(2);
    await tick(4_999);
    expect(get).toHaveBeenCalledTimes(2);
    await tick(1);
    expect(get).toHaveBeenCalledTimes(3);
  });

  it('refreshes on visibility resume, opening and table creation, then stops after logout', async () => {
    render(<JunoSession />);
    const setVisibility = (next: DocumentVisibilityState) => {
      visibility = next;
      document.dispatchEvent(new Event('visibilitychange'));
    };
    await update(() => setVisibility('hidden'));
    await tick(60_000);
    expect(get).toHaveBeenCalledTimes(1);
    await update(() => setVisibility('visible'));
    expect(get).toHaveBeenCalledTimes(2);
    await update(() => useJunoStore.getState().setOpen(true));
    expect(get).toHaveBeenCalledTimes(3);
    get.mockResolvedValue({ revision: 2, game: junoGame('lobby') });
    await update(() => useJunoStore.getState().invalidate('voice'));
    expect(useJunoStore.getState().snapshot?.game?.phase).toBe('lobby');
    expect(get).toHaveBeenCalledTimes(4);
    await update(() => useAuthStore.setState({ user: null }));
    await tick(60_000);
    expect(get).toHaveBeenCalledTimes(4);
    expect(useJunoStore.getState().snapshot).toBeNull();
  });

  it('does not bypass or postpone the server cooldown when opening a table', async () => {
    get.mockRejectedValueOnce(new RateLimitError(8));
    render(<JunoSession />);
    await tick(2_000);
    await update(() => useJunoStore.getState().setOpen(true));
    await tick(5_999);
    expect(get).toHaveBeenCalledTimes(1);
    await tick(1);
    expect(get).toHaveBeenCalledTimes(2);
  });
});
