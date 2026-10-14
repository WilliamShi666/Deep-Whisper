CREATE TABLE `companions` (
	`id` text PRIMARY KEY NOT NULL,
	`visitor_id` text NOT NULL,
	`character_key` text NOT NULL,
	`name` text NOT NULL,
	`persona` text,
	`occupation` text,
	`user_title` text,
	`voice_id` text,
	`appearance_style` text NOT NULL,
	`theme_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`visitor_id`) REFERENCES `visitors`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "appearance_style_valid" CHECK("companions"."appearance_style" IN ('chibi','normal')),
	CONSTRAINT "persona_length" CHECK("companions"."persona" IS NULL OR length("companions"."persona")<=600)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `companion_owner` ON `companions` (`id`,`visitor_id`);--> statement-breakpoint
CREATE INDEX `companions_owner_idx` ON `companions` (`visitor_id`);--> statement-breakpoint
CREATE TABLE `conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`visitor_id` text NOT NULL,
	`companion_id` text NOT NULL,
	`title` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`visitor_id`) REFERENCES `visitors`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`companion_id`,`visitor_id`) REFERENCES `companions`(`id`,`visitor_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "title_length" CHECK("conversations"."title" IS NULL OR length("conversations"."title")<=128)
);
--> statement-breakpoint
CREATE INDEX `conversation_owner_updated_idx` ON `conversations` (`visitor_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `message_feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`message_id` text NOT NULL,
	`visitor_id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`companion_id` text NOT NULL,
	`rating` integer NOT NULL,
	`comment` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`visitor_id`) REFERENCES `visitors`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`companion_id`) REFERENCES `companions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "feedback_rating" CHECK("message_feedback"."rating" IN (-1,1)),
	CONSTRAINT "feedback_comment" CHECK("message_feedback"."comment" IS NULL OR length("message_feedback"."comment")<=500)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `feedback_message_owner` ON `message_feedback` (`message_id`,`visitor_id`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`role` text NOT NULL,
	`content_type` text DEFAULT 'text' NOT NULL,
	`content` text,
	`image_url` text,
	`audio_url` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "message_role" CHECK("messages"."role" IN ('user','assistant')),
	CONSTRAINT "message_type" CHECK("messages"."content_type" IN ('text','image','photo_pending','photo_failed'))
);
--> statement-breakpoint
CREATE INDEX `messages_conversation_time_idx` ON `messages` (`conversation_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `operation_leases` (
	`resource_key` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `relationship_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`visitor_id` text NOT NULL,
	`companion_id` text NOT NULL,
	`relationship_stage` text,
	`emotional_tone` text,
	`dynamic_summary` text,
	`key_milestones` text DEFAULT '[]' NOT NULL,
	`observed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`visitor_id`) REFERENCES `visitors`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`companion_id`,`visitor_id`) REFERENCES `companions`(`id`,`visitor_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "relationship_milestones_json" CHECK(json_valid("relationship_snapshots"."key_milestones") AND json_type("relationship_snapshots"."key_milestones")='array')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `relationship_scope` ON `relationship_snapshots` (`visitor_id`,`companion_id`);--> statement-breakpoint
CREATE TABLE `user_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`visitor_id` text NOT NULL,
	`display_name` text,
	`birthday` text,
	`occupation` text,
	`city` text,
	`timezone` text,
	`family_members` text DEFAULT '[]' NOT NULL,
	`important_dates` text DEFAULT '[]' NOT NULL,
	`lifestyle` text DEFAULT '{}' NOT NULL,
	`communication_prefs` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`visitor_id`) REFERENCES `visitors`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "profile_family_json" CHECK(json_valid("user_profiles"."family_members") AND json_type("user_profiles"."family_members")='array'),
	CONSTRAINT "profile_dates_json" CHECK(json_valid("user_profiles"."important_dates") AND json_type("user_profiles"."important_dates")='array'),
	CONSTRAINT "profile_lifestyle_json" CHECK(json_valid("user_profiles"."lifestyle") AND json_type("user_profiles"."lifestyle")='object'),
	CONSTRAINT "profile_prefs_json" CHECK(json_valid("user_profiles"."communication_prefs") AND json_type("user_profiles"."communication_prefs")='object')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_profiles_visitor_id_unique` ON `user_profiles` (`visitor_id`);--> statement-breakpoint
CREATE TABLE `visitors` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_slot` integer DEFAULT 1 NOT NULL,
	`gender` text,
	`orientation` text,
	`nickname` text,
	`theme_id` text,
	`ui_theme` text,
	`palette` text,
	`locale` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "owner_slot_one" CHECK("visitors"."owner_slot"=1),
	CONSTRAINT "visitor_palette" CHECK("visitors"."palette" IS NULL OR "visitors"."palette" IN ('rose','blue')),
	CONSTRAINT "visitor_locale" CHECK("visitors"."locale" IS NULL OR "visitors"."locale" IN ('zh-CN','en'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `one_owner` ON `visitors` (`owner_slot`);