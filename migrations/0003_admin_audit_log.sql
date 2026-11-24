CREATE TABLE `admin_audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_google_sub` text NOT NULL,
	`action` text NOT NULL,
	`target_profile_id` text NOT NULL,
	`target_slug` text,
	`reason` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT "admin_audit_log_action_check" CHECK("admin_audit_log"."action" IN ('suspend','unsuspend','remove_images','resolve_report')),
	CONSTRAINT "admin_audit_log_reason_check" CHECK(length("admin_audit_log"."reason") BETWEEN 1 AND 1000)
);
--> statement-breakpoint
CREATE INDEX `admin_audit_log_target_idx` ON `admin_audit_log` (`target_profile_id`);--> statement-breakpoint
CREATE TRIGGER `admin_audit_log_no_update` BEFORE UPDATE ON `admin_audit_log`
BEGIN
  SELECT RAISE(ABORT, 'admin audit log is append-only');
END;--> statement-breakpoint
CREATE TRIGGER `admin_audit_log_no_delete` BEFORE DELETE ON `admin_audit_log`
BEGIN
  SELECT RAISE(ABORT, 'admin audit log is append-only');
END;
