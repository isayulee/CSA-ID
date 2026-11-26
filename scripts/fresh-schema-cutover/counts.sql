-- Read-only row counts, no row contents. Every table and column here exists in both the old and the fresh
-- schema, so the same file counts before the cutover and after it.
-- D1 allows at most 5 terms in a compound SELECT, so the counts come in chunks.
SELECT 'users' AS t, count(*) AS n FROM users
UNION ALL SELECT 'sessions', count(*) FROM sessions
UNION ALL SELECT 'profiles', count(*) FROM profiles
UNION ALL SELECT 'profiles published', count(*) FROM profiles WHERE status = 'published'
UNION ALL SELECT 'profiles suspended', count(*) FROM profiles WHERE status = 'suspended';

SELECT 'published_profiles' AS t, count(*) AS n FROM published_profiles
UNION ALL SELECT 'draft_social_links', count(*) FROM draft_social_links
UNION ALL SELECT 'published_social_links', count(*) FROM published_social_links
UNION ALL SELECT 'reserved_slugs', count(*) FROM reserved_slugs;

SELECT 'abuse_reports' AS t, count(*) AS n FROM abuse_reports
UNION ALL SELECT 'admin_audit_log', count(*) FROM admin_audit_log
UNION ALL SELECT 'd1_migrations', count(*) FROM d1_migrations;
