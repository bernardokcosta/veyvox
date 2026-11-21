import { create } from 'zustand';
import { AudioManager } from './AudioManager';
import { JUNO_MUSIC_URL } from '../components/games/junoAssets';

export type JunoMusicStatus = 'idle' | 'playing' | 'blocked' | 'error';
/** Playback feedback only, not persisted and not a second navigation/focus store. */
export const useJunoMusicState = create<{ status: JunoMusicStatus; retry: (() => void) | null }>(() => ({ status: 'idle', retry: null }));
interface Output {
  acquirePlayback: () => () => void;
  resumeContext: () => Promise<void>;
  ensureContext: () => AudioContext;
  getMasterOutput: () => AudioNode;
}
interface Dependencies { manager: () => Output; createMedia: () => HTMLAudioElement }

/** One lazily streamed track. A zero gain guards every asynchronous start. */
export function createJunoMusicPlayer(report: (status: JunoMusicStatus) => void,
  dependencies: Dependencies = { manager: () => AudioManager.getInstance(), createMedia: () => new Audio() }) {
  let media: HTMLAudioElement | null = null, gain: GainNode | null = null, source: MediaElementAudioSourceNode | null = null;
  let output: Output | null = null, active = false, disposed = false, playing = false, failed = false;
  let volume = 0, generation = 0, wired = false, status: JunoMusicStatus = 'idle';
  let pending: { resuming: boolean } | null = null;
  let releasePlayback: (() => void) | null = null;
  const setStatus = (next: JunoMusicStatus) => { if (!disposed && status !== next) { status = next; report(next); } };
  const releaseAudio = () => { releasePlayback?.(); releasePlayback = null; };
  const pause = () => {
    if (gain) gain.gain.value = 0;
    media?.pause();
    playing = false;
    releaseAudio();
    // A blocked context resume need not settle before a fresh gesture. Keep
    // serializing media.play() itself so a stale element start cannot race it.
    if (pending?.resuming) pending = null;
  };
  const releaseMedia = () => {
    pause(); media?.removeEventListener('error', onError); media?.removeAttribute('src'); media?.load();
    source?.disconnect(); gain?.disconnect(); media = null; source = null; gain = null; output = null; wired = false;
  };
  const onError = () => { if (!disposed) { generation++; failed = true; pause(); setStatus('error'); } };
  async function start(fromGesture = false) {
    if (!active || disposed || pending || playing || failed) return;
    const job = { resuming: false };
    pending = job; const attempt = generation;
    try {
      if (!media) {
        output = dependencies.manager();
        const context = output.ensureContext();
        media = dependencies.createMedia(); media.loop = true; media.preload = 'none'; media.src = JUNO_MUSIC_URL;
        media.addEventListener('error', onError);
        gain = context.createGain(); gain.gain.value = 0;
        source = context.createMediaElementSource(media); source.connect(gain); gain.connect(output.getMasterOutput());
        wired = true;
      }
      // Chromium can leave resume() pending forever before the first gesture.
      // Surface a real retry instead of waiting silently with no usable control.
      if (!fromGesture && output!.ensureContext().state === 'suspended' && !navigator.userActivation?.hasBeenActive) {
        throw new DOMException('A playback gesture is required', 'NotAllowedError');
      }
      releasePlayback = output!.acquirePlayback();
      job.resuming = true;
      await output!.resumeContext();
      if (pending !== job) return;
      job.resuming = false;
      if (!active || disposed || attempt !== generation) return;
      await media.play();
      if (!active || disposed || attempt !== generation) { pause(); return; }
      playing = true; gain!.gain.value = volume; setStatus('playing');
    } catch (error) {
      if (pending === job && !wired) releaseMedia();
      if (pending === job && !disposed && active && attempt === generation) {
        failed = true; pause(); setStatus(error instanceof DOMException && error.name === 'NotAllowedError' ? 'blocked' : 'error');
      }
    } finally {
      if (pending === job) {
        pending = null;
        if (!playing) releaseAudio();
        if (!disposed && active && !playing && !failed && attempt !== generation) void start();
      }
    }
  }
  return {
    update(eligible: boolean, nextVolume: number) {
      if (disposed) return;
      volume = Number.isFinite(nextVolume) ? Math.max(0, Math.min(1, nextVolume)) : 0;
      const nextActive = eligible && volume > 0;
      if (!nextActive) {
        if (active) generation++;
        active = false; pause(); if (!failed) setStatus('idle'); return;
      }
      active = true;
      if (playing && gain) gain.gain.value = volume;
      else void start();
    },
    retry() {
      if (!active || disposed) return;
      if (pending?.resuming) { generation++; pause(); }
      // A failed resource remains errored until load() reruns media selection.
      // Keep the same routed element; abort/invalidate any old pending play.
      if (media?.error) { generation++; pause(); media.load(); }
      failed = false; void start(true);
    },
    dispose() {
      if (disposed) return;
      disposed = true; active = false; generation++; releaseMedia();
    },
  };
}
