CREATE TABLE `abuse_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text,
	`slug` text,
	`reason` text NOT NULL,
	`details` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`slug`) REFERENCES `reserved_slugs`(`slug`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "abuse_reports_reason_check" CHECK("abuse_reports"."reason" in ('impersonation', 'malicious-link', 'prohibited-content')),
	CONSTRAINT "abuse_reports_details_check" CHECK(length("abuse_reports"."details") <= 1000),
	CONSTRAINT "abuse_reports_status_check" CHECK("abuse_reports"."status" in ('open', 'resolved', 'dismissed'))
);
--> statement-breakpoint
CREATE INDEX `abuse_reports_profile_idx` ON `abuse_reports` (`profile_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `abuse_reports_created_idx` ON `abuse_reports` (`created_at`);--> statement-breakpoint
CREATE TABLE `admin_audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_google_sub` text NOT NULL,
	`action` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`target_label` text DEFAULT '' NOT NULL,
	`reason` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT "admin_audit_log_action_check" CHECK("admin_audit_log"."action" in (
    'suspend', 'unsuspend', 'remove_images',
    'resolve_report', 'dismiss_report',
    'approve_peer_adviser', 'revoke_peer_adviser', 'update_peer_adviser',
    'assign_advising_request',
    'approve_kit_draft', 'reject_kit_draft',
    'update_course', 'merge_course', 'delete_course',
    'add_campus'
  )),
	CONSTRAINT "admin_audit_log_target_type_check" CHECK("admin_audit_log"."target_type" in ('profile', 'abuse_report', 'user', 'advising_request', 'kit_version', 'course', 'campus')),
	CONSTRAINT "admin_audit_log_target_id_check" CHECK(length("admin_audit_log"."target_id") between 1 and 64),
	CONSTRAINT "admin_audit_log_target_label_check" CHECK(length("admin_audit_log"."target_label") <= 128),
	CONSTRAINT "admin_audit_log_reason_check" CHECK("admin_audit_log"."reason" is null or (length("admin_audit_log"."reason") between 1 and 1000)),
	CONSTRAINT "admin_audit_log_target_matches_action_check" CHECK("admin_audit_log"."target_type" = case
    when "admin_audit_log"."action" in ('suspend', 'unsuspend', 'remove_images') then 'profile'
    when "admin_audit_log"."action" in ('resolve_report', 'dismiss_report') then 'abuse_report'
    when "admin_audit_log"."action" in ('approve_peer_adviser', 'revoke_peer_adviser', 'update_peer_adviser') then 'user'
    when "admin_audit_log"."action" = 'assign_advising_request' then 'advising_request'
    when "admin_audit_log"."action" in ('approve_kit_draft', 'reject_kit_draft') then 'kit_version'
    when "admin_audit_log"."action" in ('update_course', 'merge_course', 'delete_course') then 'course'
    when "admin_audit_log"."action" = 'add_campus' then 'campus'
  end)
);
--> statement-breakpoint
CREATE INDEX `admin_audit_log_target_idx` ON `admin_audit_log` (`target_type`,`target_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `advisee_contacts` (
	`request_id` text PRIMARY KEY NOT NULL,
	`full_name` text NOT NULL,
	`student_number` text NOT NULL,
	`program_year` text DEFAULT '' NOT NULL,
	`email` text NOT NULL,
	`cardinal_mail` text NOT NULL,
	FOREIGN KEY (`request_id`) REFERENCES `advising_requests`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "advisee_contacts_full_name_check" CHECK(length("advisee_contacts"."full_name") between 1 and 200),
	CONSTRAINT "advisee_contacts_student_number_check" CHECK(length("advisee_contacts"."student_number") <= 32),
	CONSTRAINT "advisee_contacts_program_year_check" CHECK(length("advisee_contacts"."program_year") <= 64),
	CONSTRAINT "advisee_contacts_email_check" CHECK(length("advisee_contacts"."email") <= 320),
	CONSTRAINT "advisee_contacts_cardinal_mail_check" CHECK(length("advisee_contacts"."cardinal_mail") <= 320)
);
--> statement-breakpoint
CREATE TABLE `advising_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`author_user_id` text,
	`body` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`request_id`) REFERENCES `advising_requests`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "advising_notes_body_check" CHECK(length("advising_notes"."body") between 1 and 2000)
);
--> statement-breakpoint
CREATE INDEX `advising_notes_request_idx` ON `advising_notes` (`request_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `advising_request_slots` (
	`request_id` text NOT NULL,
	`weekday` integer NOT NULL,
	`on_date` text DEFAULT '' NOT NULL,
	`hour` integer NOT NULL,
	PRIMARY KEY(`request_id`, `weekday`, `on_date`, `hour`),
	FOREIGN KEY (`request_id`) REFERENCES `advising_requests`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "advising_request_slots_weekday_check" CHECK("advising_request_slots"."weekday" between 1 and 6),
	CONSTRAINT "advising_request_slots_on_date_check" CHECK("advising_request_slots"."on_date" = '' or "advising_request_slots"."on_date" glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "advising_request_slots_hour_check" CHECK("advising_request_slots"."hour" between 8 and 16)
);
--> statement-breakpoint
CREATE TABLE `advising_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`intake_key` text NOT NULL,
	`submitted_at` integer NOT NULL,
	`campus_text` text NOT NULL,
	`campus_id` text,
	`course_text` text NOT NULL,
	`course_code` text,
	`topic` text DEFAULT '' NOT NULL,
	`attendee_count` integer DEFAULT 1 NOT NULL,
	`available_day_text` text DEFAULT '' NOT NULL,
	`available_time_text` text DEFAULT '' NOT NULL,
	`times_unclear` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`claimed_by_user_id` text,
	`claimed_at` integer,
	`scheduled_on` text,
	`scheduled_start` text,
	`sheet_peer_adviser` text,
	`sheet_remarks` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`campus_id`) REFERENCES `campuses`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`course_code`) REFERENCES `courses`(`code`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`claimed_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "advising_requests_intake_key_check" CHECK(length("advising_requests"."intake_key") = 64),
	CONSTRAINT "advising_requests_campus_text_check" CHECK(length("advising_requests"."campus_text") <= 100),
	CONSTRAINT "advising_requests_course_text_check" CHECK(length("advising_requests"."course_text") <= 200),
	CONSTRAINT "advising_requests_topic_check" CHECK(length("advising_requests"."topic") <= 2000),
	CONSTRAINT "advising_requests_attendee_count_check" CHECK("advising_requests"."attendee_count" between 1 and 50),
	CONSTRAINT "advising_requests_available_day_text_check" CHECK(length("advising_requests"."available_day_text") <= 500),
	CONSTRAINT "advising_requests_available_time_text_check" CHECK(length("advising_requests"."available_time_text") <= 500),
	CONSTRAINT "advising_requests_times_unclear_check" CHECK("advising_requests"."times_unclear" in (0, 1)),
	CONSTRAINT "advising_requests_status_check" CHECK("advising_requests"."status" in (
    'pending', 'rescheduled', 'done', 'cancelled',
    'no_peer_adviser_available', 'no_response_from_advisee'
  )),
	CONSTRAINT "advising_requests_scheduled_on_check" CHECK("advising_requests"."scheduled_on" is null or ("advising_requests"."scheduled_on" glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')),
	CONSTRAINT "advising_requests_scheduled_start_check" CHECK("advising_requests"."scheduled_start" is null or ("advising_requests"."scheduled_start" glob '[0-2][0-9]:[0-5][0-9]')),
	CONSTRAINT "advising_requests_sheet_peer_adviser_check" CHECK("advising_requests"."sheet_peer_adviser" is null or (length("advising_requests"."sheet_peer_adviser") <= 200)),
	CONSTRAINT "advising_requests_sheet_remarks_check" CHECK("advising_requests"."sheet_remarks" is null or (length("advising_requests"."sheet_remarks") <= 2000)),
	CONSTRAINT "advising_requests_schedule_check" CHECK("advising_requests"."scheduled_start" is null or "advising_requests"."scheduled_on" is not null)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `advising_requests_intake_key_unique` ON `advising_requests` (`intake_key`);--> statement-breakpoint
CREATE INDEX `advising_requests_status_idx` ON `advising_requests` (`status`,`submitted_at`);--> statement-breakpoint
CREATE INDEX `advising_requests_claimed_idx` ON `advising_requests` (`claimed_by_user_id`,`status`);--> statement-breakpoint
CREATE TABLE `campuses` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT "campuses_id_check" CHECK(length("campuses"."id") between 2 and 32 and "campuses"."id" not glob '*[^a-z0-9-]*'),
	CONSTRAINT "campuses_name_check" CHECK(length("campuses"."name") between 1 and 64)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `campuses_name_unique` ON `campuses` (`name`);--> statement-breakpoint
CREATE TABLE `courses` (
	`code` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`created_by_user_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "courses_code_check" CHECK(length("courses"."code") between 2 and 16
    and "courses"."code" glob '[A-Z]*'
    and "courses"."code" not glob '*[^A-Z0-9-]*'
    and "courses"."code" not glob '*-'),
	CONSTRAINT "courses_title_check" CHECK(length("courses"."title") between 1 and 128)
);
--> statement-breakpoint
CREATE TABLE `draft_social_links` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`service` text NOT NULL,
	`url` text NOT NULL,
	`display_order` integer NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "draft_link_service_check" CHECK("draft_social_links"."service" in ('linkedin', 'instagram', 'facebook', 'github', 'youtube', 'tiktok', 'x', 'website')),
	CONSTRAINT "draft_link_url_check" CHECK("draft_social_links"."url" glob 'https://*' and length("draft_social_links"."url") <= 500),
	CONSTRAINT "draft_link_order_check" CHECK("draft_social_links"."display_order" between 0 and 9)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `draft_link_service_idx` ON `draft_social_links` (`profile_id`,`service`);--> statement-breakpoint
CREATE UNIQUE INDEX `draft_link_order_idx` ON `draft_social_links` (`profile_id`,`display_order`);--> statement-breakpoint
CREATE TABLE `kit_files` (
	`id` text PRIMARY KEY NOT NULL,
	`kv_key` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`uploaded_by_user_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`uploaded_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "kit_files_size_bytes_check" CHECK("kit_files"."size_bytes" between 1 and 5242880)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `kit_files_kv_key_unique` ON `kit_files` (`kv_key`);--> statement-breakpoint
CREATE TABLE `kit_items` (
	`id` text PRIMARY KEY NOT NULL,
	`version_id` text NOT NULL,
	`kind` text NOT NULL,
	`label` text NOT NULL,
	`url` text,
	`file_id` text,
	`display_order` integer NOT NULL,
	FOREIGN KEY (`version_id`) REFERENCES `kit_versions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`file_id`) REFERENCES `kit_files`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "kit_items_kind_check" CHECK("kit_items"."kind" in ('pdf', 'drive', 'youtube')),
	CONSTRAINT "kit_items_label_check" CHECK(length("kit_items"."label") between 1 and 128),
	CONSTRAINT "kit_items_url_check" CHECK("kit_items"."url" is null or ("kit_items"."url" glob 'https://*' and length("kit_items"."url") <= 500)),
	CONSTRAINT "kit_items_display_order_check" CHECK("kit_items"."display_order" between 0 and 49),
	CONSTRAINT "kit_items_file_check" CHECK(("kit_items"."kind" = 'pdf') = ("kit_items"."file_id" is not null)),
	CONSTRAINT "kit_items_url_kind_check" CHECK(("kit_items"."kind" = 'pdf') = ("kit_items"."url" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `kit_items_order_idx` ON `kit_items` (`version_id`,`display_order`);--> statement-breakpoint
CREATE INDEX `kit_items_file_idx` ON `kit_items` (`file_id`);--> statement-breakpoint
CREATE TABLE `kit_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`kit_id` text NOT NULL,
	`base_version_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`title` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`author_user_id` text,
	`review_note` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`reviewed_at` integer,
	FOREIGN KEY (`kit_id`) REFERENCES `teaching_kits`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`base_version_id`) REFERENCES `kit_versions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`author_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "kit_versions_status_check" CHECK("kit_versions"."status" in ('pending', 'approved', 'rejected')),
	CONSTRAINT "kit_versions_title_check" CHECK(length("kit_versions"."title") between 1 and 128),
	CONSTRAINT "kit_versions_body_check" CHECK(length("kit_versions"."body") <= 20000),
	CONSTRAINT "kit_versions_review_note_check" CHECK("kit_versions"."review_note" is null or (length("kit_versions"."review_note") between 1 and 1000)),
	CONSTRAINT "kit_versions_reviewed_check" CHECK(("kit_versions"."status" = 'pending') = ("kit_versions"."reviewed_at" is null)),
	CONSTRAINT "kit_versions_rejected_note_check" CHECK("kit_versions"."status" != 'rejected' or "kit_versions"."review_note" is not null)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `kit_versions_one_pending_per_author` ON `kit_versions` (`kit_id`,`author_user_id`) WHERE "kit_versions"."status" = 'pending';--> statement-breakpoint
CREATE INDEX `kit_versions_kit_idx` ON `kit_versions` (`kit_id`,`status`);--> statement-breakpoint
CREATE INDEX `kit_versions_pending_idx` ON `kit_versions` (`created_at`) WHERE "kit_versions"."status" = 'pending';--> statement-breakpoint
CREATE TABLE `peer_adviser_availability` (
	`user_id` text NOT NULL,
	`weekday` integer NOT NULL,
	`hour` integer NOT NULL,
	PRIMARY KEY(`user_id`, `weekday`, `hour`),
	FOREIGN KEY (`user_id`) REFERENCES `peer_advisers`(`user_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "peer_adviser_availability_weekday_check" CHECK("peer_adviser_availability"."weekday" between 1 and 6),
	CONSTRAINT "peer_adviser_availability_hour_check" CHECK("peer_adviser_availability"."hour" between 8 and 16)
);
--> statement-breakpoint
CREATE TABLE `peer_adviser_courses` (
	`user_id` text NOT NULL,
	`course_code` text NOT NULL,
	PRIMARY KEY(`user_id`, `course_code`),
	FOREIGN KEY (`user_id`) REFERENCES `peer_advisers`(`user_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`course_code`) REFERENCES `courses`(`code`) ON UPDATE cascade ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `peer_adviser_courses_course_idx` ON `peer_adviser_courses` (`course_code`);--> statement-breakpoint
CREATE TABLE `peer_advisers` (
	`user_id` text PRIMARY KEY NOT NULL,
	`campus_id` text NOT NULL,
	`officer_position` text,
	`officer_order` integer,
	`approved_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`campus_id`) REFERENCES `campuses`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "peer_advisers_officer_position_check" CHECK("peer_advisers"."officer_position" is null or (length("peer_advisers"."officer_position") between 1 and 64)),
	CONSTRAINT "peer_advisers_officer_order_check" CHECK("peer_advisers"."officer_order" is null or ("peer_advisers"."officer_order" between 1 and 99)),
	CONSTRAINT "peer_advisers_officer_check" CHECK(("peer_advisers"."officer_position" is null) = ("peer_advisers"."officer_order" is null))
);
--> statement-breakpoint
CREATE INDEX `peer_advisers_campus_idx` ON `peer_advisers` (`campus_id`);--> statement-breakpoint
CREATE TABLE `profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`slug` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`display_name` text DEFAULT '' NOT NULL,
	`role_title` text DEFAULT '' NOT NULL,
	`bio` text DEFAULT '' NOT NULL,
	`accent_color` text DEFAULT '#B5121B' NOT NULL,
	`icon_color` text,
	`card_color` text,
	`card_opacity` integer,
	`card_frosted` integer,
	`avatar_key` text,
	`background_key` text,
	`evaluation_url` text,
	`student_number` text,
	`show_student_number` integer DEFAULT false NOT NULL,
	`terms_version` text,
	`terms_accepted_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`slug`) REFERENCES `reserved_slugs`(`slug`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "profiles_status_check" CHECK("profiles"."status" in ('draft', 'published', 'suspended')),
	CONSTRAINT "profiles_display_name_check" CHECK(length("profiles"."display_name") <= 128),
	CONSTRAINT "profiles_role_title_check" CHECK(length("profiles"."role_title") <= 128),
	CONSTRAINT "profiles_bio_check" CHECK(length("profiles"."bio") <= 500),
	CONSTRAINT "profiles_accent_color_check" CHECK(length("profiles"."accent_color") = 7 and "profiles"."accent_color" glob '#*' and substr("profiles"."accent_color", 2) not glob '*[^0-9A-Fa-f]*'),
	CONSTRAINT "profiles_icon_color_check" CHECK("profiles"."icon_color" is null or (length("profiles"."icon_color") = 7 and "profiles"."icon_color" glob '#*' and substr("profiles"."icon_color", 2) not glob '*[^0-9A-Fa-f]*')),
	CONSTRAINT "profiles_card_color_check" CHECK("profiles"."card_color" is null or (length("profiles"."card_color") = 7 and "profiles"."card_color" glob '#*' and substr("profiles"."card_color", 2) not glob '*[^0-9A-Fa-f]*')),
	CONSTRAINT "profiles_card_opacity_check" CHECK("profiles"."card_opacity" is null or ("profiles"."card_opacity" between 70 and 100)),
	CONSTRAINT "profiles_card_frosted_check" CHECK("profiles"."card_frosted" is null or ("profiles"."card_frosted" in (0, 1))),
	CONSTRAINT "profiles_evaluation_url_check" CHECK("profiles"."evaluation_url" is null or ("profiles"."evaluation_url" glob 'https://*' and length("profiles"."evaluation_url") <= 500)),
	CONSTRAINT "profiles_student_number_check" CHECK("profiles"."student_number" is null or (length("profiles"."student_number") between 1 and 32 and "profiles"."student_number" not glob '*[^0-9]*')),
	CONSTRAINT "profiles_show_student_number_check" CHECK("profiles"."show_student_number" in (0, 1)),
	CONSTRAINT "profiles_terms_version_check" CHECK("profiles"."terms_version" is null or (length("profiles"."terms_version") between 1 and 32)),
	CONSTRAINT "profiles_card_style_check" CHECK(("profiles"."icon_color" is null) = ("profiles"."card_color" is null)
    and ("profiles"."card_color" is null) = ("profiles"."card_opacity" is null)
    and ("profiles"."card_opacity" is null) = ("profiles"."card_frosted" is null)),
	CONSTRAINT "profiles_terms_check" CHECK(("profiles"."terms_version" is null) = ("profiles"."terms_accepted_at" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `profiles_user_id_unique` ON `profiles` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `profiles_slug_unique` ON `profiles` (`slug`);--> statement-breakpoint
CREATE TABLE `published_profiles` (
	`profile_id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`display_name` text NOT NULL,
	`role_title` text NOT NULL,
	`bio` text NOT NULL,
	`accent_color` text NOT NULL,
	`icon_color` text,
	`card_color` text,
	`card_opacity` integer,
	`card_frosted` integer,
	`avatar_key` text,
	`background_key` text,
	`evaluation_url` text NOT NULL,
	`student_number` text,
	`show_student_number` integer DEFAULT false NOT NULL,
	`published_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`slug`) REFERENCES `reserved_slugs`(`slug`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `published_profiles_slug_unique` ON `published_profiles` (`slug`);--> statement-breakpoint
CREATE TABLE `published_social_links` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`service` text NOT NULL,
	`url` text NOT NULL,
	`display_order` integer NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `published_profiles`(`profile_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "published_link_service_check" CHECK("published_social_links"."service" in ('linkedin', 'instagram', 'facebook', 'github', 'youtube', 'tiktok', 'x', 'website')),
	CONSTRAINT "published_link_url_check" CHECK("published_social_links"."url" glob 'https://*' and length("published_social_links"."url") <= 500),
	CONSTRAINT "published_link_order_check" CHECK("published_social_links"."display_order" between 0 and 9)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `published_link_service_idx` ON `published_social_links` (`profile_id`,`service`);--> statement-breakpoint
CREATE UNIQUE INDEX `published_link_order_idx` ON `published_social_links` (`profile_id`,`display_order`);--> statement-breakpoint
CREATE TABLE `reserved_slugs` (
	`slug` text PRIMARY KEY NOT NULL,
	`reserved_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT "reserved_slugs_slug_check" CHECK(length("reserved_slugs"."slug") between 3 and 64
    and "reserved_slugs"."slug" not glob '*[^a-z0-9-]*'
    and "reserved_slugs"."slug" not glob '-*' and "reserved_slugs"."slug" not glob '*-' and "reserved_slugs"."slug" not glob '*--*')
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "sessions_token_hash_check" CHECK(length("sessions"."token_hash") = 64)
);
--> statement-breakpoint
CREATE INDEX `sessions_user_id_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `sessions_expires_at_idx` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `teaching_kits` (
	`id` text PRIMARY KEY NOT NULL,
	`course_code` text NOT NULL,
	`academic_year` integer NOT NULL,
	`term` integer NOT NULL,
	`current_version_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`course_code`) REFERENCES `courses`(`code`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`current_version_id`) REFERENCES `kit_versions`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "teaching_kits_academic_year_check" CHECK("teaching_kits"."academic_year" between 2000 and 2100),
	CONSTRAINT "teaching_kits_term_check" CHECK("teaching_kits"."term" between 1 and 4)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `teaching_kits_course_term_idx` ON `teaching_kits` (`course_code`,`academic_year`,`term`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`google_sub` text NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`age_confirmed_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT "users_email_check" CHECK(length("users"."email") <= 320),
	CONSTRAINT "users_name_check" CHECK(length("users"."name") between 1 and 128)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_google_sub_unique` ON `users` (`google_sub`);--> statement-breakpoint
CREATE INDEX `users_email_idx` ON `users` (`email`);--> statement-breakpoint
-- Written by hand from here on: drizzle-kit cannot express triggers or seed rows.
-- A later migration that rebuilds `profiles` or `admin_audit_log` must re-create their triggers.
CREATE TRIGGER `profiles_updated_at` AFTER UPDATE ON `profiles`
BEGIN
  UPDATE `profiles` SET `updated_at` = unixepoch() WHERE `id` = NEW.`id`;
END;--> statement-breakpoint
CREATE TRIGGER `profiles_slug_immutable` BEFORE UPDATE OF `slug` ON `profiles`
WHEN OLD.`slug` IS NOT NULL AND NEW.`slug` IS NOT OLD.`slug`
BEGIN
  SELECT RAISE(ABORT, 'profile slug is permanent');
END;--> statement-breakpoint
CREATE TRIGGER `admin_audit_log_no_update` BEFORE UPDATE ON `admin_audit_log`
BEGIN
  SELECT RAISE(ABORT, 'admin audit log is append-only');
END;--> statement-breakpoint
CREATE TRIGGER `admin_audit_log_no_delete` BEFORE DELETE ON `admin_audit_log`
BEGIN
  SELECT RAISE(ABORT, 'admin audit log is append-only');
END;--> statement-breakpoint
INSERT INTO `campuses` (`id`, `name`) VALUES ('intramuros', 'Intramuros'), ('makati', 'Makati');