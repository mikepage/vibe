ALTER TABLE `apps` ADD `outbound` text DEFAULT 'disabled' NOT NULL;--> statement-breakpoint
ALTER TABLE `apps` ADD `outbound_hosts` text DEFAULT '[]' NOT NULL;