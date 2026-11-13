CREATE TABLE `drafts` (
	`app_id` text PRIMARY KEY NOT NULL,
	`prompts` text NOT NULL,
	`base_version` integer,
	`created_by` text NOT NULL,
	`attempts` integer NOT NULL,
	`build_ms` integer NOT NULL,
	`bundle_bytes` integer NOT NULL,
	`hash` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE cascade
);
