-- PROTOTYPE, wipe me. Cutover part 1 of 3: stage the old rows, then drop the old tables child-first.
-- Built into cutover.sql by build.sh and run as ONE `wrangler d1 execute --file`, which D1 applies all-or-nothing.
PRAGMA defer_foreign_keys = on;

-- Plain copies (data only, no constraints). They survive until cleanup.sql, so verify.sql can compare old and new.
CREATE TABLE old_users AS SELECT * FROM users;
CREATE TABLE old_profiles AS SELECT * FROM profiles;
CREATE TABLE old_reserved_slugs AS SELECT * FROM reserved_slugs;
CREATE TABLE old_draft_social_links AS SELECT * FROM draft_social_links;
CREATE TABLE old_published_profiles AS SELECT * FROM published_profiles;
CREATE TABLE old_published_social_links AS SELECT * FROM published_social_links;
CREATE TABLE old_abuse_reports AS SELECT * FROM abuse_reports;
CREATE TABLE old_admin_audit_log AS SELECT * FROM admin_audit_log;
CREATE TABLE old_session_count AS SELECT count(*) AS n FROM sessions;   -- Sessions are not carried; everyone signs in again.

-- Children before parents, so no ON DELETE CASCADE ever has a row to act on.
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
