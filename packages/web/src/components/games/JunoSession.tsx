import { useEffect, useMemo } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { useSpaceStore } from '../../stores/spaceStore';
import { useVoiceStore } from '../../stores/voiceStore';
import { useJunoStore } from '../../stores/junoStore';
import { JunoSounds } from './JunoSounds';
import { JunoMusic } from './JunoMusic';

const ACTIVE_REFRESH_MS = 5_000;
const PASSIVE_REFRESH_MS = 30_000;

/** One lifecycle owner, also while viewing text or a minimized mobile call. */
export function JunoSession() {
  const userId = useAuthStore(s => s.user?.id);
  const channelId = useVoiceStore(s => s.currentVoiceChannelId);
  const connected = useVoiceStore(s => s.isLiveKitConnected && s.voiceConnectionStatus === 'connected');
  const channel = useSpaceStore(s => channelId ? s.spaceChannelIndex.get(channelId) : undefined);
  const supported = useJunoStore(s => s.supported);
  const target = useMemo(() => userId && channelId && channel?.type === 'voice' && supported
    ? { userId, channelId, origin: window.location.origin } : null, [userId, channelId, channel?.type, supported]);
  useEffect(() => {
    const store = useJunoStore.getState();
    store.bind(target, connected);
    if (!target || !connected) return;
    const cadence = (state: typeof store) =>
      state.presentedViews.size > 0 || state.snapshot?.game?.players.some(player => player.userId === target.userId)
        ? ACTIVE_REFRESH_MS : PASSIVE_REFRESH_MS;
    const visible = () => document.visibilityState === 'visible';
    let lastAttemptAt = Date.now();
    let timer: number | undefined;
    const remaining = () => {
      const state = useJunoStore.getState();
      return Math.max(0, Math.max(lastAttemptAt, state.observedAt) + cadence(state) - Date.now());
    };
    const refresh = () => {
      lastAttemptAt = Date.now();
      void store.load();
    };
    const arm = () => {
      window.clearTimeout(timer);
      if (!visible()) return;
      timer = window.setTimeout(() => {
        if (!visible()) return;
        // A private read (or command reply) can satisfy this safety check.
        // WS invalidations themselves never wait on the polling cadence.
        if (remaining() === 0) refresh();
        arm();
      }, remaining());
    };
    const resume = () => {
      if (visible()) refresh();
      arm();
    };
    const unsubscribe = useJunoStore.subscribe((state, previous) => {
      const nowPresented = state.presentedViews.size > 0 && previous.presentedViews.size === 0;
      if (visible() && ((state.open && !previous.open) || nowPresented)) {
        refresh();
        arm();
      } else if (cadence(state) !== cadence(previous)) arm();
    });
    refresh();
    arm();
    document.addEventListener('visibilitychange', resume);
    return () => {
      unsubscribe();
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [target, connected]);
  return <><JunoSounds target={target} connected={connected} /><JunoMusic target={target} /></>;
}
