import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioManager } from './AudioManager';
import { cancelOutgoingDmCall, startDmCall } from '../utils/voiceActions';
import { useVoiceStore } from '../stores/voiceStore';

vi.mock('@sapphi-red/web-noise-suppressor', () => ({
  RnnoiseWorkletNode: class {},
  loadRnnoise: vi.fn(),
}));
vi.mock('../hooks/useWebSocket', () => ({ wsSend: () => true }));
vi.mock('../hooks/useLiveKit', () => ({ getActiveRoom: () => null }));

function mockContext() {
  const node = () => ({ connect: vi.fn(), disconnect: vi.fn() });
  const param = () => ({ value: 0, setValueAtTime: vi.fn(), setTargetAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() });
  const inputGain = { ...node(), gain: param() };
  const oscillator = { ...node(), frequency: param(), start: vi.fn(), stop: vi.fn() };
  const bufferSource = Object.assign(new EventTarget(), node(), { start: vi.fn(), buffer: null, loop: false });
  const ctx = {
    state: 'running' as AudioContextState,
    currentTime: 0,
    destination: {},
    onstatechange: null as (() => void) | null,
    resume: vi.fn(async () => { ctx.state = 'running'; ctx.onstatechange?.(); }),
    suspend: vi.fn(async () => { ctx.state = 'suspended'; ctx.onstatechange?.(); }),
    createGain: vi.fn(() => ({ ...node(), gain: param() })).mockReturnValueOnce(inputGain),
    createMediaStreamDestination: vi.fn(),
    createMediaStreamSource: vi.fn(node),
    createAnalyser: vi.fn(() => ({ fftSize: 0 })),
    createDynamicsCompressor: vi.fn(() => ({
      ...node(), threshold: param(), knee: param(), ratio: param(), attack: param(), release: param(),
    })),
    createOscillator: vi.fn(() => oscillator),
    createBufferSource: vi.fn(() => bufferSource),
    decodeAudioData: vi.fn(async () => ({ duration: 2 })),
  };
  return { ctx, inputGain, oscillator, bufferSource };
}

describe('Web Audio activity', () => {
  let manager: AudioManager;
  let fixture: ReturnType<typeof mockContext>;
  let construct: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.useFakeTimers();
    (AudioManager as unknown as { instance: AudioManager | null }).instance = null;
    manager = AudioManager.getInstance();
    fixture = mockContext();
    construct = vi.fn(function () { return fixture.ctx; });
    vi.stubGlobal('AudioContext', construct);
    useVoiceStore.setState({
      activeDmCall: null, outgoingCall: null, incomingCall: null, currentVoiceChannelId: null,
      isLiveKitConnected: false, voiceConnectionStatus: 'disconnected', inputDeviceId: 'default',
    });
  });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('keeps a saved input gain and unrelated gestures from initializing audio', () => {
    manager.setInputVolume(65);
    manager.resumeIfInUse();
    expect(construct).not.toHaveBeenCalled();
    manager.ensureContext();
    expect(fixture.inputGain.gain.setValueAtTime).toHaveBeenCalledWith(.65, 0);
    expect(fixture.oscillator.start).not.toHaveBeenCalled();
  });

  it('suspends a running idle context after 1.5 seconds, including graph-only use', async () => {
    manager.ensureContext();
    await vi.advanceTimersByTimeAsync(1499);
    expect(fixture.ctx.suspend).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(fixture.ctx.suspend).toHaveBeenCalledOnce();
    manager.resumeIfInUse();
    expect(fixture.ctx.resume).not.toHaveBeenCalled();
  });

  it('holds overlapping voices and playback, but runs the keep-alive oscillator only for voice', async () => {
    const older = manager.acquireAudioSession();
    const newer = manager.acquireAudioSession();
    const playback = manager.acquirePlayback();
    await manager.resumeContext();
    expect(fixture.oscillator.start).toHaveBeenCalledOnce();
    older(); older();
    await vi.advanceTimersByTimeAsync(2000);
    expect(fixture.oscillator.stop).not.toHaveBeenCalled();
    newer();
    expect(fixture.oscillator.stop).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(2000);
    expect(fixture.ctx.suspend).not.toHaveBeenCalled();
    playback(); playback();
    await vi.advanceTimersByTimeAsync(1500);
    expect(fixture.ctx.suspend).toHaveBeenCalledOnce();
  });

  it('holds a one-shot until it ends without taking ownership of its caller’s ended handler', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) })));
    const cue = await manager.playSound('cue');
    expect(cue).not.toBeNull();
    await vi.advanceTimersByTimeAsync(2000);
    expect(fixture.ctx.suspend).not.toHaveBeenCalled();
    fixture.bufferSource.dispatchEvent(new Event('ended'));
    expect(fixture.bufferSource.disconnect).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1500);
    expect(fixture.ctx.suspend).toHaveBeenCalledOnce();
  });

  it('does not suspend live mic capture from the normal input path', async () => {
    const track = { stop: vi.fn(), onended: null };
    const stream = { active: true, getTracks: () => [track] };
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn(async () => stream) } });
    await manager.setInputDevice('default');
    await vi.advanceTimersByTimeAsync(2000);
    expect(fixture.ctx.suspend).not.toHaveBeenCalled();
    manager.releaseInputStream();
    expect(track.stop).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1500);
    expect(fixture.ctx.suspend).toHaveBeenCalledOnce();
  });

  it('releases pre-armed capture when canceling an unaccepted DM and suspends', async () => {
    const track = { stop: vi.fn(), onended: null };
    const stream = { active: true, getTracks: () => [track] };
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn(async () => stream) } });
    expect(startDmCall('old-dm')).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(manager.hasActiveStream()).toBe(true);
    expect(cancelOutgoingDmCall('old-dm')).toBe(true);
    expect(track.stop).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1500);
    expect(fixture.ctx.state).toBe('suspended');
  });

  it('discards a late canceled DM permission result without invalidating a newer pre-arm', async () => {
    const oldTrack = { stop: vi.fn(), onended: null };
    const newTrack = { stop: vi.fn(), onended: null };
    const stream = (track: typeof oldTrack) => ({ active: true, getTracks: () => [track] });
    let finishOld!: (result: ReturnType<typeof stream>) => void;
    const getUserMedia = vi.fn(async () => stream(newTrack))
      .mockReturnValueOnce(new Promise(resolve => { finishOld = resolve; }));
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });

    expect(startDmCall('old-dm')).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(getUserMedia).toHaveBeenCalledOnce();
    expect(cancelOutgoingDmCall('old-dm')).toBe(true);
    expect(startDmCall('new-dm')).toBe(true);
    finishOld(stream(oldTrack));
    await vi.advanceTimersByTimeAsync(0);

    expect(oldTrack.stop).toHaveBeenCalledOnce();
    expect(newTrack.stop).not.toHaveBeenCalled();
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(manager.hasActiveStream()).toBe(true);
  });

  it('keeps capture already owned by a connected space when its DM ring is canceled', async () => {
    const track = { stop: vi.fn(), onended: null };
    const stream = { active: true, getTracks: () => [track] };
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn(async () => stream) } });
    await manager.setInputDevice('default');
    useVoiceStore.setState({ currentVoiceChannelId: 'space-voice', isLiveKitConnected: true, voiceConnectionStatus: 'connected' });
    expect(startDmCall('old-dm')).toBe(true);
    expect(cancelOutgoingDmCall('old-dm')).toBe(true);
    expect(track.stop).not.toHaveBeenCalled();
    expect(manager.hasActiveStream()).toBe(true);
  });

  it('keeps a pending capture with an audio session even before the store reports connecting', async () => {
    const track = { stop: vi.fn(), onended: null };
    const stream = { active: true, getTracks: () => [track] };
    let finish!: (result: typeof stream) => void;
    vi.stubGlobal('navigator', { mediaDevices: {
      getUserMedia: vi.fn(() => new Promise(resolve => { finish = resolve; })),
    } });
    expect(startDmCall('old-dm')).toBe(true);
    await vi.advanceTimersByTimeAsync(0);

    const release = manager.acquireAudioSession();
    useVoiceStore.setState({ currentVoiceChannelId: 'space-voice' });
    expect(cancelOutgoingDmCall('old-dm')).toBe(true);
    finish(stream);
    await vi.advanceTimersByTimeAsync(0);
    expect(track.stop).not.toHaveBeenCalled();
    expect(manager.hasActiveStream()).toBe(true);
    manager.releaseInputStream();
    release();
    await vi.advanceTimersByTimeAsync(1500);
    expect(fixture.ctx.state).toBe('suspended');
  });

  it('releases a canceled call tone while its context resume is still pending', async () => {
    let finish!: () => void;
    fixture.ctx.resume.mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve; }));
    manager.ensureContext();
    fixture.ctx.state = 'suspended';
    const controller = new AbortController();
    const cue = manager.playSound('call_ringing', { loop: true, signal: controller.signal });
    controller.abort();
    await vi.advanceTimersByTimeAsync(0);
    expect(await Promise.race([cue, Promise.resolve('pending')])).toBeNull();
    manager.resumeIfInUse();
    expect(fixture.ctx.resume).toHaveBeenCalledOnce();
    finish();
    expect(fixture.ctx.createBufferSource).not.toHaveBeenCalled();
  });

  it('queues a new resume even when the browser has not finished an idle suspend', async () => {
    let finishSuspend!: () => void;
    const suspending = new Promise<void>(resolve => { finishSuspend = resolve; });
    fixture.ctx.suspend.mockImplementationOnce(async () => {
      await suspending;
      fixture.ctx.state = 'suspended';
    });
    fixture.ctx.resume.mockImplementationOnce(async () => {
      await suspending;
      fixture.ctx.state = 'running';
    });
    manager.ensureContext();
    await vi.advanceTimersByTimeAsync(1500);
    const release = manager.acquirePlayback();
    const resume = manager.resumeContext();
    const called = fixture.ctx.resume.mock.calls.length;
    finishSuspend();
    await resume;
    expect(called).toBe(1);
    expect(fixture.ctx.state).toBe('running');
    release();
  });
});
