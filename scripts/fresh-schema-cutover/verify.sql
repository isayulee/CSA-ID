-- Read-only checks after cutover.sql, while the old_* copies still exist.
-- A result whose first column is "problem" lists what's wrong and must come back empty, and so must
-- PRAGMA foreign_key_check. wizard.sh and rehearse.sh fail on any row in one. The other results are for the
-- person running the evening to read.
-- D1 allows at most 5 terms in a compound SELECT, so some checks come in chunks.

-- Every row was carried, Sessions on purpose not: each old key is in the new table.
-- This covers every reserved Slug, including those of deleted accounts.
SELECT 'row not carried' AS problem, 'users' AS t, id AS row_key FROM old_users WHERE id NOT IN (SELECT id FROM users)
UNION ALL SELECT 'row not carried', 'profiles', id FROM old_profiles WHERE id NOT IN (SELECT id FROM profiles)
UNION ALL SELECT 'row not carried', 'reserved_slugs', slug FROM old_reserved_slugs WHERE slug NOT IN (SELECT slug FROM reserved_slugs)
UNION ALL SELECT 'row not carried', 'draft_social_links', id FROM old_draft_social_links WHERE id NOT IN (SELECT id FROM draft_social_links);
SELECT 'row not carried' AS problem, 'published_profiles' AS t, profile_id AS row_key FROM old_published_profiles WHERE profile_id NOT IN (SELECT profile_id FROM published_profiles)
UNION ALL SELECT 'row not carried', 'published_social_links', id FROM old_published_social_links WHERE id NOT IN (SELECT id FROM published_social_links)
UNION ALL SELECT 'row not carried', 'abuse_reports', id FROM old_abuse_reports WHERE id NOT IN (SELECT id FROM abuse_reports)
UNION ALL SELECT 'row not carried', 'admin_audit_log', id FROM old_admin_audit_log WHERE id NOT IN (SELECT id FROM admin_audit_log);

-- No Slug moved: every Profile keeps its Slug, and every Published Profile still opens at its Slug (the NFC Card).
SELECT 'slug moved' AS problem, o.id AS profile_id, o.slug AS before, n.slug AS after
FROM old_profiles o JOIN profiles n ON n.id = o.id WHERE o.slug IS NOT n.slug
UNION ALL SELECT 'published slug moved', o.profile_id, o.slug, n.slug
FROM old_published_profiles o LEFT JOIN published_profiles n ON n.profile_id = o.profile_id WHERE o.slug IS NOT n.slug;

-- Structure: the fresh 0000 is the only applied migration, and its four triggers and two Campuses exist.
SELECT 'unexpected migration' AS problem, name FROM d1_migrations WHERE name <> '0000_fresh_schema.sql'
UNION ALL SELECT 'fresh 0000 not recorded', '0000_fresh_schema.sql'
WHERE NOT EXISTS (SELECT 1 FROM d1_migrations WHERE name = '0000_fresh_schema.sql');
SELECT 'trigger missing' AS problem, t.name
FROM (SELECT 'profiles_updated_at' AS name UNION ALL SELECT 'profiles_slug_immutable'
  UNION ALL SELECT 'admin_audit_log_no_update' UNION ALL SELECT 'admin_audit_log_no_delete') t
WHERE t.name NOT IN (SELECT name FROM sqlite_master WHERE type = 'trigger');
SELECT 'campus missing' AS problem, c.id
FROM (SELECT 'intramuros' AS id UNION ALL SELECT 'makati') c WHERE c.id NOT IN (SELECT id FROM campuses);

-- No row breaks a foreign key.
PRAGMA foreign_key_check;

-- For the record: rows before and after. Sessions aren't carried; everyone signs in again.
SELECT 'users' AS t, (SELECT count(*) FROM old_users) AS before, (SELECT count(*) FROM users) AS after
UNION ALL SELECT 'profiles', (SELECT count(*) FROM old_profiles), (SELECT count(*) FROM profiles)
UNION ALL SELECT 'reserved_slugs', (SELECT count(*) FROM old_reserved_slugs), (SELECT count(*) FROM reserved_slugs)
UNION ALL SELECT 'draft_social_links', (SELECT count(*) FROM old_draft_social_links), (SELECT count(*) FROM draft_social_links)
UNION ALL SELECT 'published_profiles', (SELECT count(*) FROM old_published_profiles), (SELECT count(*) FROM published_profiles);
SELECT 'published_social_links' AS t, (SELECT count(*) FROM old_published_social_links) AS before, (SELECT count(*) FROM published_social_links) AS after
UNION ALL SELECT 'abuse_reports', (SELECT count(*) FROM old_abuse_reports), (SELECT count(*) FROM abuse_reports)
UNION ALL SELECT 'admin_audit_log', (SELECT count(*) FROM old_admin_audit_log), (SELECT count(*) FROM admin_audit_log)
UNION ALL SELECT 'sessions (not carried)', (SELECT n FROM old_session_count), (SELECT count(*) FROM sessions);

-- What the transforms changed, so the owner can tell the Peer Advisers concerned.
SELECT 'role_title' AS field, n.id, o.role AS before, n.role_title AS after
FROM old_profiles o JOIN profiles n ON n.id = o.id WHERE o.role IS NOT n.role_title
UNION ALL SELECT 'evaluation_url', n.id, o.evaluation_url, n.evaluation_url
FROM old_profiles o JOIN profiles n ON n.id = o.id WHERE o.evaluation_url IS NOT n.evaluation_url AND o.evaluation_url <> ''
UNION ALL SELECT 'published evaluation_url', n.profile_id, o.evaluation_url, n.evaluation_url
FROM old_published_profiles o JOIN published_profiles n ON n.profile_id = o.profile_id WHERE o.evaluation_url IS NOT n.evaluation_url
UNION ALL SELECT 'users.name', n.id, o.name, n.name FROM old_users o JOIN users n ON n.id = o.id WHERE o.name IS NOT n.name;

-- The appearance JSON, now four columns.
SELECT n.id, o.appearance AS before_json, n.icon_color, n.card_color, n.card_opacity, n.card_frosted
FROM old_profiles o JOIN profiles n ON n.id = o.id WHERE o.appearance IS NOT NULL;

-- Abuse Reports with the Slug they now carry, and the audit log with its targets.
SELECT id, profile_id, slug, reason, status FROM abuse_reports;
SELECT action, target_type, target_id, target_label, reason FROM admin_audit_log;
