import type { FastifyInstance, FastifyReply } from 'fastify';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import { authenticate, requireAdmin } from '../utils/auth.js';
import { config } from '../config.js';
import { sendError } from '../utils/httpErrors.js';
import { connectionManager } from '../ws/handler.js';
import type { InstanceStreamingLimits, InstanceAdminSettings, CameraStreamingLimits } from '@veyvox/shared';
import { STANDARD_RESOLUTIONS, STANDARD_FRAMERATES, BITRATE_MATRIX_KBPS } from '@veyvox/shared/src/constants.js';

function parseAllowedNumbers(raw: string, allowed: readonly number[]): number[] {
  return raw
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && (allowed as readonly number[]).includes(n));
}

function toCameraLimits(row: typeof schema.instanceSettings.$inferSelect): CameraStreamingLimits {
  return {
    mode: row.cameraMode === 'user-choice' ? 'user-choice' : 'fixed',
    defaultResolution: row.cameraDefaultResolution,
    defaultFramerate: row.cameraDefaultFramerate,
    defaultBitrateKbps: row.cameraDefaultBitrateKbps,
    allowedResolutions: parseAllowedNumbers(row.cameraAllowedResolutions, STANDARD_RESOLUTIONS),
    allowedFramerates: parseAllowedNumbers(row.cameraAllowedFramerates, STANDARD_FRAMERATES),
    minBitrateKbps: row.cameraMinBitrateKbps,
    maxBitrateKbps: row.cameraMaxBitrateKbps,
    allowCustomBitrate: row.cameraAllowCustomBitrate === 1,
  };
}

function rowToLimits(row: typeof schema.instanceSettings.$inferSelect): InstanceStreamingLimits {
  return {
    maxBitrateKbps: row.maxBitrateKbps,
    minBitrateKbps: row.minBitrateKbps,
    bitrateStepKbps: row.bitrateStepKbps,
    allowedResolutions: row.allowedResolutions.split(',')
      .map((s) => s.trim())
      .map((s) => s === 'native' ? 'native' as const : Number(s))
      .filter((v): v is number | 'native' =>
        v === 'native' || (typeof v === 'number' && !isNaN(v) && (STANDARD_RESOLUTIONS as readonly number[]).includes(v))
      ),
    allowedFramerates: row.allowedFramerates.split(',')
      .map(Number)
      .filter((n) => (STANDARD_FRAMERATES as readonly number[]).includes(n)),
    maxResolution: row.maxResolution,
    maxFramerate: row.maxFramerate,
    bitrateMatrixOverrides: (() => {
      const raw = row.bitrateMatrixOverrides as string | null;
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
        return Object.keys(parsed).length > 0 ? parsed as Record<string, number> : null;
      } catch { return null; }
    })(),
    allowCustomBitrate: row.allowCustomBitrate === 1,
    camera: toCameraLimits(row),
  };
}

type SettingsRow = typeof schema.instanceSettings.$inferSelect;

/** Bounds the disk-cleanup fields are validated against (see utils/diskPressure.ts). */
const DISK_THRESHOLD_MIN = 50;
const DISK_THRESHOLD_MAX = 99;
const DISK_TARGET_MIN = 10;
const DISK_TARGET_GAP = 5;
const DISK_AGE_MIN_DAYS = 1;
const DISK_AGE_MAX_DAYS = 3650;

/**
 * Validates and applies the disk-cleanup fields. The target is checked against
 * the threshold that will be in force after this write (the new one when the
 * body carries it), so raising the target and lowering the threshold in one
 * request is judged together. Returns false after sending the error reply.
 */
function applyDiskCleanup(
  body: Record<string, unknown>,
  updateData: SettingsUpdate,
  currentRow: SettingsRow,
  reply: FastifyReply,
): boolean {
  if (body.diskCleanupEnabled !== undefined) {
    if (typeof body.diskCleanupEnabled !== 'boolean') {
      sendError(reply, 400, 'field_not_boolean', { field: 'diskCleanupEnabled' });
      return false;
    }
    updateData.diskCleanupEnabled = body.diskCleanupEnabled ? 1 : 0;
  }

  let threshold = currentRow.diskCleanupThresholdPercent;
  if (body.diskCleanupThresholdPercent !== undefined) {
    const value = Number(body.diskCleanupThresholdPercent);
    if (!Number.isInteger(value) || value < DISK_THRESHOLD_MIN || value > DISK_THRESHOLD_MAX) {
      sendError(reply, 400, 'disk_cleanup_threshold_out_of_range', { min: DISK_THRESHOLD_MIN, max: DISK_THRESHOLD_MAX });
      return false;
    }
    threshold = value;
    updateData.diskCleanupThresholdPercent = value;
  }

  const maxTarget = threshold - DISK_TARGET_GAP;
  const target = body.diskCleanupTargetPercent !== undefined
    ? Number(body.diskCleanupTargetPercent)
    : currentRow.diskCleanupTargetPercent;
  if (body.diskCleanupTargetPercent !== undefined || body.diskCleanupThresholdPercent !== undefined) {
    if (!Number.isInteger(target) || target < DISK_TARGET_MIN || target > maxTarget) {
      sendError(reply, 400, 'disk_cleanup_target_out_of_range', { min: DISK_TARGET_MIN, max: maxTarget });
      return false;
    }
    updateData.diskCleanupTargetPercent = target;
  }

  if (body.diskCleanupMinAgeDays !== undefined) {
    const value = Number(body.diskCleanupMinAgeDays);
    if (!Number.isInteger(value) || value < DISK_AGE_MIN_DAYS || value > DISK_AGE_MAX_DAYS) {
      sendError(reply, 400, 'disk_cleanup_age_out_of_range', { min: DISK_AGE_MIN_DAYS, max: DISK_AGE_MAX_DAYS });
      return false;
    }
    updateData.diskCleanupMinAgeDays = value;
  }
  return true;
}
type SettingsUpdate = Record<string, number | string | boolean | null>;

function rowToAdminSettings(row: SettingsRow): InstanceAdminSettings {
  const gifKey = row.gifApiKey as string | null;
  const maxUploadBytes = row.maxUploadSizeBytes ?? config.maxUploadSize;
  const maxStickerBytes = row.maxStickerSizeBytes ?? config.maxStickerSize;
  return {
    instanceName: row.instanceName ?? 'Veyvox',
    registrationOpen: row.registrationOpen !== null ? row.registrationOpen === 1 : config.registrationOpen,
    spaceCreationOpen: row.spaceCreationOpen !== 0,
    gifApiKey: gifKey ? `****${gifKey.slice(-4)}` : undefined,
    gifEnabled: !!gifKey,
    maxUploadSizeMb: Math.round(maxUploadBytes / (1024 * 1024)),
    maxStickerSizeMb: Math.round(maxStickerBytes / (1024 * 1024)),
    diskCleanupEnabled: row.diskCleanupEnabled === 1,
    diskCleanupThresholdPercent: row.diskCleanupThresholdPercent,
    diskCleanupTargetPercent: row.diskCleanupTargetPercent,
    diskCleanupMinAgeDays: row.diskCleanupMinAgeDays,
  };
}

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/settings/streaming — any authenticated user can read instance limits
  app.get('/api/settings/streaming', { preHandler: authenticate }, async (_request, reply) => {
    const db = getDb();
    const row = db.select().from(schema.instanceSettings).where(eq(schema.instanceSettings.id, 1)).get();
    if (!row) {
      return sendError(reply, 500, 'instance_settings_missing');
    }
    return reply.code(200).send(rowToLimits(row));
  });

  // PATCH /api/settings/streaming — admin only
  app.patch<{ Body: Partial<InstanceStreamingLimits> }>('/api/settings/streaming', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const db = getDb();

    const body = request.body;
    const updateData: SettingsUpdate = { updatedAt: Date.now() };

    if (body.maxBitrateKbps !== undefined) {
      if (typeof body.maxBitrateKbps !== 'number' || body.maxBitrateKbps < 500 || body.maxBitrateKbps > 1000000) {
        return sendError(reply, 400, 'streaming_max_bitrate_out_of_range', { min: 500, max: 1000000 });
      }
      updateData.maxBitrateKbps = body.maxBitrateKbps;
    }

    if (body.minBitrateKbps !== undefined) {
      if (typeof body.minBitrateKbps !== 'number' || body.minBitrateKbps < 100 || body.minBitrateKbps > 1000000) {
        return sendError(reply, 400, 'streaming_min_bitrate_out_of_range', { min: 100, max: 1000000 });
      }
      updateData.minBitrateKbps = body.minBitrateKbps;
    }

    if (body.bitrateStepKbps !== undefined) {
      if (typeof body.bitrateStepKbps !== 'number' || body.bitrateStepKbps < 50 || body.bitrateStepKbps > 5000) {
        return sendError(reply, 400, 'streaming_bitrate_step_out_of_range', { min: 50, max: 5000 });
      }
      updateData.bitrateStepKbps = body.bitrateStepKbps;
    }

    if (body.allowedResolutions !== undefined) {
      if (!Array.isArray(body.allowedResolutions) || body.allowedResolutions.length === 0) {
        return sendError(reply, 400, 'streaming_resolutions_required');
      }
      const invalid = body.allowedResolutions.filter((r) =>
        r !== 'native' && !(STANDARD_RESOLUTIONS as readonly number[]).includes(r as number)
      );
      if (invalid.length > 0) {
        return sendError(reply, 400, 'streaming_resolutions_invalid', {
          invalid: invalid.join(', '),
          allowed: [...STANDARD_RESOLUTIONS, 'native'].join(', '),
        });
      }
      // Serialize: numbers sorted ascending, 'native' always last
      const nums = body.allowedResolutions.filter((r): r is number => r !== 'native').sort((a, b) => a - b);
      const hasNative = body.allowedResolutions.includes('native');
      updateData.allowedResolutions = [...nums, ...(hasNative ? ['native'] : [])].join(',');
    }

    if (body.allowedFramerates !== undefined) {
      if (!Array.isArray(body.allowedFramerates) || body.allowedFramerates.length === 0) {
        return sendError(reply, 400, 'streaming_framerates_required');
      }
      const invalid = body.allowedFramerates.filter((f) => !(STANDARD_FRAMERATES as readonly number[]).includes(f));
      if (invalid.length > 0) {
        return sendError(reply, 400, 'streaming_framerates_invalid', {
          invalid: invalid.join(', '),
          allowed: STANDARD_FRAMERATES.join(', '),
        });
      }
      updateData.allowedFramerates = body.allowedFramerates.sort((a, b) => a - b).join(',');
    }

    if (body.maxResolution !== undefined) {
      if (!(STANDARD_RESOLUTIONS as readonly number[]).includes(body.maxResolution)) {
        return sendError(reply, 400, 'streaming_max_resolution_invalid', { allowed: STANDARD_RESOLUTIONS.join(', ') });
      }
      updateData.maxResolution = body.maxResolution;
    }

    if (body.maxFramerate !== undefined) {
      if (!(STANDARD_FRAMERATES as readonly number[]).includes(body.maxFramerate)) {
        return sendError(reply, 400, 'streaming_max_framerate_invalid', { allowed: STANDARD_FRAMERATES.join(', ') });
      }
      updateData.maxFramerate = body.maxFramerate;
    }

    if (body.allowCustomBitrate !== undefined) {
      updateData.allowCustomBitrate = body.allowCustomBitrate ? 1 : 0;
    }

    if (body.camera !== undefined) {
      if (typeof body.camera !== 'object' || body.camera === null || Array.isArray(body.camera)) {
        return sendError(reply, 400, 'validation_failed', { field: 'camera' });
      }
      const cameraRow = db.select().from(schema.instanceSettings).where(eq(schema.instanceSettings.id, 1)).get();
      if (!cameraRow) {
        return sendError(reply, 500, 'instance_settings_missing');
      }
      const patch = body.camera as Partial<CameraStreamingLimits>;
      const camera: CameraStreamingLimits = { ...toCameraLimits(cameraRow), ...patch };

      if (camera.mode !== 'fixed' && camera.mode !== 'user-choice') {
        return sendError(reply, 400, 'camera_mode_invalid');
      }
      if (!Array.isArray(camera.allowedResolutions) || camera.allowedResolutions.length === 0) {
        return sendError(reply, 400, 'camera_resolutions_invalid', {
          invalid: '', allowed: STANDARD_RESOLUTIONS.join(', '),
        });
      }
      const invalidResolutions = camera.allowedResolutions.filter(
        (r) => !(STANDARD_RESOLUTIONS as readonly number[]).includes(r),
      );
      if (invalidResolutions.length > 0) {
        return sendError(reply, 400, 'camera_resolutions_invalid', {
          invalid: invalidResolutions.join(', '), allowed: STANDARD_RESOLUTIONS.join(', '),
        });
      }
      if (!Array.isArray(camera.allowedFramerates) || camera.allowedFramerates.length === 0) {
        return sendError(reply, 400, 'camera_framerates_invalid', {
          invalid: '', allowed: STANDARD_FRAMERATES.join(', '),
        });
      }
      const invalidFramerates = camera.allowedFramerates.filter(
        (fps) => !(STANDARD_FRAMERATES as readonly number[]).includes(fps),
      );
      if (invalidFramerates.length > 0) {
        return sendError(reply, 400, 'camera_framerates_invalid', {
          invalid: invalidFramerates.join(', '), allowed: STANDARD_FRAMERATES.join(', '),
        });
      }
      if (
        !Number.isInteger(camera.minBitrateKbps)
        || !Number.isInteger(camera.maxBitrateKbps)
        || camera.minBitrateKbps < 100
        || camera.maxBitrateKbps > 1000000
        || camera.minBitrateKbps >= camera.maxBitrateKbps
      ) {
        return sendError(reply, 400, 'camera_bitrate_out_of_range', { min: 100, max: 1000000 });
      }
      if (
        !Number.isInteger(camera.defaultBitrateKbps)
        || camera.defaultBitrateKbps < camera.minBitrateKbps
        || camera.defaultBitrateKbps > camera.maxBitrateKbps
      ) {
        return sendError(reply, 400, 'camera_bitrate_out_of_range', {
          min: camera.minBitrateKbps, max: camera.maxBitrateKbps,
        });
      }
      if (!camera.allowedResolutions.includes(camera.defaultResolution)) {
        return sendError(reply, 400, 'camera_default_not_allowed', { field: 'resolution' });
      }
      if (!camera.allowedFramerates.includes(camera.defaultFramerate)) {
        return sendError(reply, 400, 'camera_default_not_allowed', { field: 'framerate' });
      }
      if (typeof camera.allowCustomBitrate !== 'boolean') {
        return sendError(reply, 400, 'validation_failed', { field: 'camera.allowCustomBitrate' });
      }

      updateData.cameraMode = camera.mode;
      updateData.cameraDefaultResolution = camera.defaultResolution;
      updateData.cameraDefaultFramerate = camera.defaultFramerate;
      updateData.cameraDefaultBitrateKbps = camera.defaultBitrateKbps;
      updateData.cameraAllowedResolutions = [...camera.allowedResolutions].sort((a, b) => a - b).join(',');
      updateData.cameraAllowedFramerates = [...camera.allowedFramerates].sort((a, b) => a - b).join(',');
      updateData.cameraMinBitrateKbps = camera.minBitrateKbps;
      updateData.cameraMaxBitrateKbps = camera.maxBitrateKbps;
      updateData.cameraAllowCustomBitrate = camera.allowCustomBitrate ? 1 : 0;
    }

    if (body.bitrateMatrixOverrides !== undefined) {
      if (body.bitrateMatrixOverrides === null) {
        updateData.bitrateMatrixOverrides = null;
      } else if (typeof body.bitrateMatrixOverrides !== 'object' || Array.isArray(body.bitrateMatrixOverrides)) {
        return sendError(reply, 400, 'streaming_bitrate_matrix_invalid');
      } else {
        // Validate each key and value
        const validKeys = new Set<string>();
        for (const res of STANDARD_RESOLUTIONS) {
          for (const fps of STANDARD_FRAMERATES) {
            validKeys.add(`${res}_${fps}`);
          }
        }
        for (const [key, value] of Object.entries(body.bitrateMatrixOverrides)) {
          if (!validKeys.has(key)) {
            return sendError(reply, 400, 'streaming_bitrate_matrix_key_invalid', { key });
          }
          if (typeof value !== 'number' || value <= 0 || value > 1000000) {
            return sendError(reply, 400, 'streaming_bitrate_matrix_value_invalid', { key, max: 1000000 });
          }
        }
        updateData.bitrateMatrixOverrides = JSON.stringify(body.bitrateMatrixOverrides);
      }
    }

    // Cross-field validation: min < max
    const currentRow = db.select().from(schema.instanceSettings).where(eq(schema.instanceSettings.id, 1)).get();
    if (!currentRow) {
      return sendError(reply, 500, 'instance_settings_missing');
    }

    const effectiveMin = (updateData.minBitrateKbps as number | undefined) ?? currentRow.minBitrateKbps;
    const effectiveMax = (updateData.maxBitrateKbps as number | undefined) ?? currentRow.maxBitrateKbps;
    if (effectiveMin >= effectiveMax) {
      return sendError(reply, 400, 'streaming_min_bitrate_not_below_max');
    }

    db.update(schema.instanceSettings).set(updateData).where(eq(schema.instanceSettings.id, 1)).run();

    const updatedRow = db.select().from(schema.instanceSettings).where(eq(schema.instanceSettings.id, 1)).get();
    if (!updatedRow) {
      return sendError(reply, 500, 'instance_settings_reload_failed');
    }

    return reply.code(200).send(rowToLimits(updatedRow));
  });

  // GET /api/settings/instance — admin only, returns instance admin settings
  app.get('/api/settings/instance', { preHandler: [authenticate, requireAdmin] }, async (_request, reply) => {
    const db = getDb();

    const row = db.select().from(schema.instanceSettings).where(eq(schema.instanceSettings.id, 1)).get();
    if (!row) {
      return sendError(reply, 500, 'instance_settings_missing');
    }

    return reply.code(200).send(rowToAdminSettings(row));
  });

  // PATCH /api/settings/instance — admin only, updates instance admin settings
  app.patch<{ Body: Partial<InstanceAdminSettings> }>('/api/settings/instance', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const db = getDb();

    const body = request.body;
    const updateData: SettingsUpdate = { updatedAt: Date.now() };

    if (body.instanceName !== undefined) {
      if (typeof body.instanceName !== 'string' || body.instanceName.trim().length === 0 || body.instanceName.trim().length > 32) {
        return sendError(reply, 400, 'instance_name_length', { min: 1, max: 32 });
      }
      updateData.instanceName = body.instanceName.trim();
    }

    if (body.registrationOpen !== undefined) {
      updateData.registrationOpen = body.registrationOpen ? 1 : 0;
    }

    if (body.spaceCreationOpen !== undefined) {
      if (typeof body.spaceCreationOpen !== 'boolean') {
        return sendError(reply, 400, 'field_not_boolean', { field: 'spaceCreationOpen' });
      }
      updateData.spaceCreationOpen = body.spaceCreationOpen ? 1 : 0;
    }

    if (body.gifApiKey !== undefined) {
      // Skip masked placeholder values — the GET endpoint returns '****xxxx' for security,
      // so if the client sends that back unchanged, don't corrupt the real key
      if (typeof body.gifApiKey === 'string' && body.gifApiKey.startsWith('****')) {
        // Masked value — ignore, keep existing key
      } else {
        // Allow empty string to clear the key
        updateData.gifApiKey = body.gifApiKey ? body.gifApiKey.trim() : null;
      }
    }

    if (body.maxUploadSizeMb !== undefined) {
      const mb = Number(body.maxUploadSizeMb);
      const MAX_MB = Math.floor(Number.MAX_SAFE_INTEGER / (1024 * 1024));
      if (!Number.isFinite(mb) || !Number.isInteger(mb) || mb < 1 || mb > MAX_MB) {
        return sendError(reply, 400, 'upload_limit_out_of_range', { min: 1, max: MAX_MB });
      }
      updateData.maxUploadSizeBytes = mb * 1024 * 1024;
    }

    if (body.maxStickerSizeMb !== undefined) {
      const mb = Number(body.maxStickerSizeMb);
      const MAX_MB = Math.floor(Number.MAX_SAFE_INTEGER / (1024 * 1024));
      if (!Number.isFinite(mb) || !Number.isInteger(mb) || mb < 1 || mb > MAX_MB) {
        return sendError(reply, 400, 'sticker_limit_out_of_range', { min: 1, max: MAX_MB });
      }
      updateData.maxStickerSizeBytes = mb * 1024 * 1024;
    }

    const currentRow = db.select().from(schema.instanceSettings).where(eq(schema.instanceSettings.id, 1)).get();
    if (!currentRow) {
      return sendError(reply, 500, 'instance_settings_missing');
    }

    if (!applyDiskCleanup(body as Record<string, unknown>, updateData, currentRow, reply)) return;

    db.update(schema.instanceSettings).set(updateData).where(eq(schema.instanceSettings.id, 1)).run();

    const updatedRow = db.select().from(schema.instanceSettings).where(eq(schema.instanceSettings.id, 1)).get();
    if (!updatedRow) {
      return sendError(reply, 500, 'instance_settings_reload_failed');
    }

    if (body.spaceCreationOpen !== undefined && currentRow.spaceCreationOpen !== updatedRow.spaceCreationOpen) {
      connectionManager.sendToAll({
        type: 'instance_settings_updated',
        spaceCreationOpen: updatedRow.spaceCreationOpen === 1,
      });
    }

    return reply.code(200).send(rowToAdminSettings(updatedRow));
  });
}
