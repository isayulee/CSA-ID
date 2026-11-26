-- Run only after the cutover is kept: drop the staged copies of the old rows. Safe to run again.
DROP TABLE IF EXISTS old_users;
DROP TABLE IF EXISTS old_profiles;
DROP TABLE IF EXISTS old_reserved_slugs;
DROP TABLE IF EXISTS old_draft_social_links;
DROP TABLE IF EXISTS old_published_profiles;
DROP TABLE IF EXISTS old_published_social_links;
DROP TABLE IF EXISTS old_abuse_reports;
DROP TABLE IF EXISTS old_admin_audit_log;
DROP TABLE IF EXISTS old_session_count;
