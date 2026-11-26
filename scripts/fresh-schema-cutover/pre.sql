-- Cutover part 1 of 3: refuse the wrong database, stage the old rows, then drop the old tables child-first.
-- build.sh joins the three parts into cutover.sql, which runs as ONE `wrangler d1 execute --file`.
-- D1 applies that file all-or-nothing, so a failure anywhere in it leaves the database as it was.
PRAGMA defer_foreign_keys = TRUE;

-- Run only on the live schema at its five migrations, and so only once. On any other database the insert
-- fails its check before a row is touched.
CREATE TABLE cutover_guard (at_live_0004 INTEGER NOT NULL CHECK (at_live_0004 = 1));
INSERT INTO cutover_guard (at_live_0004)
SELECT count(*) = 5 AND (SELECT count(*) FROM d1_migrations) = 5 FROM d1_migrations
WHERE name IN ('0000_init_users_sessions.sql', '0001_initial.sql', '0002_reserved_slugs_survive_deletion.sql',
  '0003_admin_audit_log.sql', '0004_profile_evaluation_appearance.sql');
DROP TABLE cutover_guard;

-- Plain copies (data only, no constraints). They stay until cleanup.sql, so verify.sql can compare old and new.
CREATE TABLE old_users AS SELECT * FROM users;
CREATE TABLE old_profiles AS SELECT * FROM profiles;
CREATE TABLE old_reserved_slugs AS SELECT * FROM reserved_slugs;
CREATE TABLE old_draft_social_links AS SELECT * FROM draft_social_links;
CREATE TABLE old_published_profiles AS SELECT * FROM published_profiles;
CREATE TABLE old_published_social_links AS SELECT * FROM published_social_links;
CREATE TABLE old_abuse_reports AS SELECT * FROM abuse_reports;
CREATE TABLE old_admin_audit_log AS SELECT * FROM admin_audit_log;
-- Sessions aren't carried: everyone signs in again. Only their count is kept, for verify.sql.
CREATE TABLE old_session_count AS SELECT count(*) AS n FROM sessions;

-- Children before parents, so no ON DELETE CASCADE ever has a row to act on: D1 ignores
-- PRAGMA foreign_keys = OFF, and dropping a parent table still runs its cascades.
-- DROP TABLE fires no triggers, so the append-only audit log drops cleanly.
DROP TABLE sessions;
DROP TABLE draft_social_links;
DROP TABLE published_social_links;
DROP TABLE published_profiles;
DROP TABLE abuse_reports;
DROP TABLE reserved_slugs;
DROP TABLE profiles;
DROP TABLE users;
DROP TABLE admin_audit_log;
