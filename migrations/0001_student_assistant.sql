-- Hand-written instead of drizzle-kit's table rebuild: D1 ignores PRAGMA foreign_keys=OFF,
-- so dropping peer_advisers would cascade-delete every Peer Adviser's courses and Availability.
-- ADD COLUMN keeps every row; the check is a column constraint here and a named table check in the snapshot.
ALTER TABLE `peer_advisers` ADD `student_assistant` integer DEFAULT 0 NOT NULL CHECK (`student_assistant` in (0, 1));
