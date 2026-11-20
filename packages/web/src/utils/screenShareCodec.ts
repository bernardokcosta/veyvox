import { supportsAV1, supportsH265, supportsVP9 } from 'livekit-client';
import type { VideoCodec } from 'livekit-client';

export type ScreenShareCodec = 'vp9' | 'h264' | 'h265';
export type ScreenShareCodecPreference = ScreenShareCodec | 'auto';
export const AUTO_SCREEN_SHARE_QUALITY = { height: 1080, fps: 60, customBitrateKbps: null, codec: 'auto' } as const;

function supportsScreenCodec(probe: () => boolean): boolean {
  try {
    return typeof RTCRtpSender !== 'undefined'
      && typeof RTCRtpSender.getCapabilities === 'function'
      && probe();
  } catch {
    return false;
  }
}

export function normalizeScreenShareCodec(value: unknown): ScreenShareCodecPreference {
  return value === 'auto' || value === 'h264' || value === 'h265' ? value : 'vp9';
}

/** WebRTC availability only; this does not identify a hardware encoder/vendor. */
export function supportsScreenShareH265(): boolean {
  return supportsScreenCodec(supportsH265);
}

/** Fit the device-local preference without overwriting it on a different host. */
export function resolveScreenShareCodec(codec: ScreenShareCodecPreference): ScreenShareCodec {
  // Prefer the known compatible path until a codec-specific first-publish
  // failure can be identified and safely retried in this runtime.
  if (codec === 'auto') return 'h264';
  return codec === 'h265' && !supportsScreenShareH265() ? 'h264' : codec;
}

/** Intersect the host's publish order with local policy and the SDK's codec probes. */
export function resolveAdvertisedScreenShareCodec(participant: unknown, requested: ScreenShareCodec): VideoCodec | null {
  const compatible = (codec: VideoCodec): boolean => {
    if (codec === 'h265') return requested === 'h265' && supportsScreenShareH265();
    if (codec === 'vp9') return supportsScreenCodec(supportsVP9);
    if (codec === 'av1') return supportsScreenCodec(supportsAV1);
    return true;
  };
  // LiveKit replaces unsupported VP9 with VP8 before checking the host list.
  const preferred = compatible(requested) ? requested : requested === 'h265' ? 'h264' : 'vp8';
  if (!participant || typeof participant !== 'object') return preferred;
  const entries = (participant as { enabledPublishVideoCodecs?: unknown }).enabledPublishVideoCodecs;
  if (!Array.isArray(entries) || entries.length === 0) return preferred;
  const allowed = entries.flatMap((entry): VideoCodec[] => {
    if (!entry || typeof entry !== 'object') return [];
    const { mime } = entry as { mime?: unknown };
    if (typeof mime !== 'string') return [];
    const [kind, codec] = mime.toLowerCase().split('/');
    return kind === 'video' && (codec === 'h264' || codec === 'h265' || codec === 'vp8' || codec === 'vp9' || codec === 'av1')
      ? [codec] : [];
  });
  // Do not knowingly pass a disallowed preference: the SDK would silently
  // choose the first entry, even HEVC when Automatic has not enabled it.
  return allowed.includes(preferred) ? preferred : allowed.find(compatible) ?? null;
}
