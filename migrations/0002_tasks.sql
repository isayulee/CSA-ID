CREATE TABLE `board_columns` (
	`id` text PRIMARY KEY NOT NULL,
	`board_id` text NOT NULL,
	`name` text NOT NULL,
	`position` integer NOT NULL,
	`is_done` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`board_id`) REFERENCES `boards`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "board_columns_name_check" CHECK(length("board_columns"."name") between 1 and 32),
	CONSTRAINT "board_columns_is_done_check" CHECK("board_columns"."is_done" in (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `board_columns_board_id_id_idx` ON `board_columns` (`board_id`,`id`);--> statement-breakpoint
CREATE INDEX `board_columns_board_idx` ON `board_columns` (`board_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `board_columns_one_done` ON `board_columns` (`board_id`) WHERE "board_columns"."is_done" = 1;--> statement-breakpoint
CREATE TABLE `boards` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`board_type` text DEFAULT 'kanban' NOT NULL,
	`position` integer NOT NULL,
	`archived_at` integer,
	`created_by_user_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "boards_name_check" CHECK(length("boards"."name") between 1 and 64)
);
--> statement-breakpoint
CREATE INDEX `boards_project_idx` ON `boards` (`project_id`,`position`);--> statement-breakpoint
CREATE TABLE `project_members` (
	`project_id` text NOT NULL,
	`user_id` text NOT NULL,
	`added_at` integer DEFAULT (unixepoch()) NOT NULL,
	PRIMARY KEY(`project_id`, `user_id`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `project_members_user_idx` ON `project_members` (`user_id`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`default_key` text,
	`name` text NOT NULL,
	`archived_at` integer,
	`created_by_user_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "projects_default_key_check" CHECK("projects"."default_key" is null or ("projects"."default_key" in ('peer_advisers', 'student_assistants', 'officers'))),
	CONSTRAINT "projects_name_check" CHECK(length("projects"."name") between 1 and 64),
	CONSTRAINT "projects_default_not_archived_check" CHECK("projects"."default_key" is null or "projects"."archived_at" is null)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_default_key_unique` ON `projects` (`default_key`);--> statement-breakpoint
CREATE TABLE `task_assignees` (
	`task_id` text NOT NULL,
	`user_id` text NOT NULL,
	PRIMARY KEY(`task_id`, `user_id`),
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `task_assignees_user_idx` ON `task_assignees` (`user_id`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`board_id` text NOT NULL,
	`column_id` text NOT NULL,
	`position` integer NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`due_on` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_by_user_id` text,
	`updated_by_user_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`board_id`) REFERENCES `boards`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`board_id`,`column_id`) REFERENCES `board_columns`(`board_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "tasks_title_check" CHECK(length("tasks"."title") between 1 and 200),
	CONSTRAINT "tasks_description_check" CHECK(length("tasks"."description") <= 4000),
	CONSTRAINT "tasks_due_on_check" CHECK("tasks"."due_on" is null or ("tasks"."due_on" glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'))
);
--> statement-breakpoint
CREATE INDEX `tasks_column_idx` ON `tasks` (`column_id`,`position`);--> statement-breakpoint
-- Hand-written seed (§15.3): the three default Projects with fixed IDs, found by default_key, never by name.
-- Each gets one kanban Board with Ready, In Progress and Done; Done is the Board's done Column.
INSERT INTO `projects` (`id`, `default_key`, `name`) VALUES
	('project-peer-advisers', 'peer_advisers', 'Peer Advisers'),
	('project-student-assistants', 'student_assistants', 'Student Assistants'),
	('project-officers', 'officers', 'Officers');--> statement-breakpoint
INSERT INTO `boards` (`id`, `project_id`, `name`, `board_type`, `position`) VALUES
	('board-peer-advisers', 'project-peer-advisers', 'Board', 'kanban', 1024),
	('board-student-assistants', 'project-student-assistants', 'Board', 'kanban', 1024),
	('board-officers', 'project-officers', 'Board', 'kanban', 1024);--> statement-breakpoint
INSERT INTO `board_columns` (`id`, `board_id`, `name`, `position`, `is_done`) VALUES
	('column-peer-advisers-ready', 'board-peer-advisers', 'Ready', 1024, 0),
	('column-peer-advisers-in-progress', 'board-peer-advisers', 'In Progress', 2048, 0),
	('column-peer-advisers-done', 'board-peer-advisers', 'Done', 3072, 1),
	('column-student-assistants-ready', 'board-student-assistants', 'Ready', 1024, 0),
	('column-student-assistants-in-progress', 'board-student-assistants', 'In Progress', 2048, 0),
	('column-student-assistants-done', 'board-student-assistants', 'Done', 3072, 1),
	('column-officers-ready', 'board-officers', 'Ready', 1024, 0),
	('column-officers-in-progress', 'board-officers', 'In Progress', 2048, 0),
	('column-officers-done', 'board-officers', 'Done', 3072, 1);
