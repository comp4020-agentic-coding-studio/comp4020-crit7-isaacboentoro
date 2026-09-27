CREATE TABLE `completed_courses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `completed_courses_code_unique` ON `completed_courses` (`code`);--> statement-breakpoint
CREATE TABLE `permission_codes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`unit_id` integer NOT NULL,
	`grants` text NOT NULL,
	`used_at` text,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `permission_codes_code_unique` ON `permission_codes` (`code`);--> statement-breakpoint
ALTER TABLE `units` ADD `requisite_text` text;--> statement-breakpoint
ALTER TABLE `units` ADD `requisite_rule` text;