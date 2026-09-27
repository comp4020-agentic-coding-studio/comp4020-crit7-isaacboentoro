CREATE TABLE `unit_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`unit_id` integer NOT NULL,
	`session` text NOT NULL,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `unit_sessions_session` ON `unit_sessions` (`session`);--> statement-breakpoint
CREATE UNIQUE INDEX `unit_sessions_unit_session` ON `unit_sessions` (`unit_id`,`session`);--> statement-breakpoint
ALTER TABLE `enrolments` ADD `session` text DEFAULT '' NOT NULL;