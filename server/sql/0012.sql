-- Add password column to feeds table for article-level access protection.
-- Stores SHA-256 hash of the user-supplied password; NULL means no protection.
ALTER TABLE `feeds` ADD COLUMN `password` text;
--> statement-breakpoint
UPDATE `info` SET `value` = '12' WHERE `key` = 'migration_version';
