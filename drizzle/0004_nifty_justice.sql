CREATE TABLE `enrolments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`unit_id` integer NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `enrolments_unit_id_unique` ON `enrolments` (`unit_id`);--> statement-breakpoint
CREATE TABLE `units` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`title` text NOT NULL,
	`period` text NOT NULL,
	`career` text NOT NULL,
	`year` integer NOT NULL,
	`credit_points` integer NOT NULL,
	`capacity` integer NOT NULL,
	`places_taken` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `units_year` ON `units` (`year`);--> statement-breakpoint
CREATE UNIQUE INDEX `units_code_year` ON `units` (`code`,`year`);