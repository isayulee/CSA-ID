ALTER TABLE `profiles` ADD `student_number` text;--> statement-breakpoint
ALTER TABLE `profiles` ADD `show_student_number` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `profiles` ADD `appearance` text;--> statement-breakpoint
ALTER TABLE `published_profiles` ADD `student_number` text;--> statement-breakpoint
ALTER TABLE `published_profiles` ADD `show_student_number` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `published_profiles` ADD `appearance` text;