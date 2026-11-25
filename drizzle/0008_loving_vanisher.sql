CREATE INDEX `enrollments_course_enrolled_idx` ON `enrollments` (`course_id`,`enrolled_at`);--> statement-breakpoint
CREATE INDEX `lesson_progress_lesson_user_idx` ON `lesson_progress` (`lesson_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `purchases_course_created_idx` ON `purchases` (`course_id`,`created_at`);