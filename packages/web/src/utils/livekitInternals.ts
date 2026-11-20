import type { Room, TrackPublishOptions } from 'livekit-client';

/**
 * Discover all unique RTCPeerConnections from the LiveKit Room engine.
 * Different livekit-client versions expose the PC at different internal paths.
 */
export function discoverPeerConnections(room: Room): RTCPeerConnection[] {
  const engine = (room as any)?.engine;
  if (!engine) return [];

  const pcs: RTCPeerConnection[] = [];
  const seen = new WeakSet<object>();

  const tryAdd = (val: any) => {
    if (val && typeof val.getStats === 'function' && !seen.has(val)) {
      seen.add(val);
      pcs.push(val);
    }
  };

  // Current livekit-client (1.x+): engine.pcManager.{publisher,subscriber}.pc
  tryAdd(engine.pcManager?.publisher?.pc);
  tryAdd(engine.pcManager?.subscriber?.pc);
  // Private backing field fallback
  tryAdd(engine.pcManager?.publisher?._pc);
  tryAdd(engine.pcManager?.subscriber?._pc);
  // Older livekit-client paths
  tryAdd(engine.publisher?.pc);
  tryAdd(engine.subscriber?.pc);
  // Unified-plan single PC
  tryAdd(engine.pc);
  tryAdd((room as any).pc);

  return pcs;
}

/**
 * Get the publisher RTCPeerConnection from a LiveKit Room.
 * Used by overdrive to inject RTP sender parameters.
 */
export function getPublisherPC(room: Room): RTCPeerConnection | null {
  const engine = (room as any)?.engine;
  if (!engine) return null;

  return (
    engine.pcManager?.publisher?.pc ??
    engine.pcManager?.publisher?._pc ??
    engine.publisher?.pc ??
    engine.pc ??
    null
  );
}

/**
 * Safely extract the underlying MediaStreamTrack from a LiveKit track object.
 * Handles both public `.mediaStreamTrack` and private `._mediaStreamTrack`.
 */
export function getMediaStreamTrack(track: unknown): MediaStreamTrack | null {
  if (!track) return null;
  const t = track as any;
  return t.mediaStreamTrack ?? t._mediaStreamTrack ?? null;
}

interface VideoEncodingState {
  encodings?: RTCRtpEncodingParameters[];
  publishOptions?: TrackPublishOptions;
  simulcastCodecs?: Map<string, {
    mediaStreamTrack?: MediaStreamTrack;
    encodings?: RTCRtpEncodingParameters[];
    sender?: RTCRtpSender;
  }>;
}

export function getBackupMediaStreamTrack(track: unknown, codec: ScreenShareBackupEncoding['codec']): MediaStreamTrack | null {
  if (!track || typeof track !== 'object') return null;
  const codecs = (track as VideoEncodingState).simulcastCodecs;
  return codecs instanceof Map ? codecs.get(codec)?.mediaStreamTrack ?? null : null;
}

/** LiveKit's backup codec owns a cloned track and a different RTP sender. */
export function getPublishedMediaStreamTracks(track: unknown): MediaStreamTrack[] {
  if (!track || typeof track !== 'object') return [];
  const state = track as VideoEncodingState;
  const tracks = [getMediaStreamTrack(track)];
  if (state.simulcastCodecs instanceof Map) {
    for (const codec of state.simulcastCodecs.values()) tracks.push(getMediaStreamTrack(codec));
  }
  const seen = new Set<string>();
  return tracks.filter((candidate): candidate is MediaStreamTrack => {
    if (!candidate?.id || seen.has(candidate.id)) return false;
    seen.add(candidate.id);
    return true;
  });
}

export function isRtpSenderActive(sender: RTCRtpSender): boolean {
  const encodings = sender.getParameters().encodings;
  return !encodings?.length || encodings.some((encoding) => encoding.active !== false);
}

type EncodingCeiling = { maxBitrate: number; maxFramerate: number; priority: RTCPriorityType };
export type ScreenShareBackupEncoding = { codec: 'h264' | 'vp8'; encoding: EncodingCeiling };
interface ScreenShareEncodingState extends VideoEncodingState {
  addSimulcastTrack?: (codec: string, encodings: RTCRtpEncodingParameters[]) => unknown;
  applyEncodingsToSender?: (sender: RTCRtpSender, encodings: RTCRtpEncodingParameters[]) => Promise<void>;
}
const screenBackupCeilings = new WeakMap<object, ScreenShareBackupEncoding | null>();

function updateVideoEncodings(encodings: RTCRtpEncodingParameters[] | undefined, ceiling: EncodingCeiling): void {
  if (!encodings?.length) return;
  const last = encodings.length - 1;
  // The SDK can put the primary's cached screenShareEncoding in this array.
  // Replace entries, never mutate objects shared by another encoding/codec.
  encodings[last] = { ...encodings[last],
    maxBitrate: ceiling.maxBitrate, maxFramerate: ceiling.maxFramerate,
  };
  encodings[0] = { ...encodings[0], priority: ceiling.priority, networkPriority: ceiling.priority };
}

/** Keep SDK 2.23's cached encodings and late backup creation aligned. */
export function syncScreenShareVideoEncodingCeilings(
  track: unknown,
  encoding: EncodingCeiling,
  degradationPreference: RTCDegradationPreference,
  backup?: ScreenShareBackupEncoding,
): void {
  if (!track || typeof track !== 'object') return;
  const state = track as ScreenShareEncodingState;
  if (state.publishOptions) {
    state.publishOptions.videoEncoding = { ...state.publishOptions.videoEncoding, ...encoding };
    state.publishOptions.screenShareEncoding = { ...state.publishOptions.screenShareEncoding, ...encoding };
    state.publishOptions.backupCodec = backup ? { codec: backup.codec, encoding: { ...backup.encoding } } : false;
    state.publishOptions.degradationPreference = degradationPreference;
  }
  updateVideoEncodings(state.encodings, encoding);
  if (!backup) {
    if (screenBackupCeilings.has(state)) screenBackupCeilings.set(state, null);
    return;
  }
  if (state.simulcastCodecs instanceof Map) {
    updateVideoEncodings(state.simulcastCodecs.get(backup.codec)?.encodings, backup.encoding);
  }
  if (screenBackupCeilings.has(state)) {
    screenBackupCeilings.set(state, backup);
    return;
  }
  screenBackupCeilings.set(state, backup);
  // SDK 2.23 computes any screen backup from screenShareEncoding, ignoring
  // backupCodec.encoding. Correct the array at sender creation and when the
  // SDK reapplies it after a resize. Both hooks are local to this publication.
  const original = state.addSimulcastTrack;
  if (original) {
    state.addSimulcastTrack = function (codec, encodings) {
      const current = screenBackupCeilings.get(this);
      if (current && codec === current.codec) updateVideoEncodings(encodings, current.encoding);
      return original.call(this, codec, encodings);
    };
  }
  const apply = state.applyEncodingsToSender;
  if (apply) {
    state.applyEncodingsToSender = function (sender, encodings) {
      const current = screenBackupCeilings.get(this);
      if (current && this.simulcastCodecs instanceof Map && this.simulcastCodecs.get(current.codec)?.sender === sender) {
        updateVideoEncodings(encodings, current.encoding);
      }
      return apply.call(this, sender, encodings);
    };
  }
}
