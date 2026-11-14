ALTER TABLE `sticker_packs` ADD `scope_type` text DEFAULT 'store' NOT NULL;--> statement-breakpoint
ALTER TABLE `sticker_packs` ADD `space_id` text REFERENCES `spaces`(`id`) ON DELETE CASCADE;--> statement-breakpoint
CREATE INDEX `idx_sticker_packs_scope` ON `sticker_packs` (`scope_type`,`space_id`,`creator_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_sticker_packs_one_space_pack` ON `sticker_packs` (`space_id`) WHERE "sticker_packs"."scope_type" = 'space';