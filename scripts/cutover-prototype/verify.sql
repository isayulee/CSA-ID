-- PROTOTYPE, wipe me. Read-only checks after the cutover, while the old_* copies still exist.

-- 1. Every carried table has as many rows as before (sessions are dropped on purpose).
--    D1 allows at most 5 terms in a compound SELECT, so this comes in two chunks.
SELECT 'users' AS t, (SELECT count(*) FROM old_users) AS before, (SELECT count(*) FROM users) AS after
UNION ALL SELECT 'profiles', (SELECT count(*) FROM old_profiles), (SELECT count(*) FROM profiles)
UNION ALL SELECT 'reserved_slugs', (SELECT count(*) FROM old_reserved_slugs), (SELECT count(*) FROM reserved_slugs)
UNION ALL SELECT 'draft_social_links', (SELECT count(*) FROM old_draft_social_links), (SELECT count(*) FROM draft_social_links)
UNION ALL SELECT 'published_profiles', (SELECT count(*) FROM old_published_profiles), (SELECT count(*) FROM published_profiles);
SELECT 'published_social_links' AS t, (SELECT count(*) FROM old_published_social_links) AS before, (SELECT count(*) FROM published_social_links) AS after
UNION ALL SELECT 'abuse_reports', (SELECT count(*) FROM old_abuse_reports), (SELECT count(*) FROM abuse_reports)
UNION ALL SELECT 'admin_audit_log', (SELECT count(*) FROM old_admin_audit_log), (SELECT count(*) FROM admin_audit_log)
UNION ALL SELECT 'sessions (dropped)', (SELECT n FROM old_session_count), (SELECT count(*) FROM sessions);

-- 2. Every Slug still opens the same Profile it opened before (the NFC Card check). Expect 0 rows.
SELECT o.slug AS slug_that_moved FROM old_profiles o JOIN profiles n ON n.id = o.id
WHERE o.slug IS NOT n.slug
UNION ALL
SELECT o.slug FROM old_published_profiles o
WHERE NOT EXISTS (SELECT 1 FROM published_profiles n WHERE n.slug = o.slug AND n.profile_id = o.profile_id);

-- 3. Every reserved Slug is still reserved. Expect 0 rows.
SELECT slug AS reservation_lost FROM old_reserved_slugs WHERE slug NOT IN (SELECT slug FROM reserved_slugs);

-- 4. What the transforms changed, for the owner to tell the affected Peer Advisers.
SELECT 'role_title' AS field, n.id, o.role AS before, n.role_title AS after FROM old_profiles o JOIN profiles n ON n.id = o.id WHERE o.role IS NOT n.role_title
UNION ALL SELECT 'evaluation_url', n.id, o.evaluation_url, n.evaluation_url FROM old_profiles o JOIN profiles n ON n.id = o.id WHERE o.evaluation_url IS NOT n.evaluation_url AND o.evaluation_url <> ''
UNION ALL SELECT 'published evaluation_url', n.profile_id, o.evaluation_url, n.evaluation_url FROM old_published_profiles o JOIN published_profiles n ON n.profile_id = o.profile_id WHERE o.evaluation_url IS NOT n.evaluation_url
UNION ALL SELECT 'users.name', n.id, o.name, n.name FROM old_users o JOIN users n ON n.id = o.id WHERE o.name IS NOT n.name;

-- 5. Appearance moved from JSON into columns.
SELECT n.id, o.appearance AS before_json, n.icon_color, n.card_color, n.card_opacity, n.card_frosted
FROM old_profiles o JOIN profiles n ON n.id = o.id WHERE o.appearance IS NOT NULL;

-- 6. Abuse Reports kept their Slug; the audit log entry kept its target.
SELECT id, profile_id, slug, status FROM abuse_reports;
SELECT action, target_type, target_id, target_label, reason FROM admin_audit_log;

-- 7. Structure: 4 triggers, 2 seeded Campuses, exactly one applied migration, no broken foreign key.
SELECT 'trigger' AS kind, name FROM sqlite_master WHERE type = 'trigger'
UNION ALL SELECT 'campus', id FROM campuses
UNION ALL SELECT 'migration', name FROM d1_migrations;
PRAGMA foreign_key_check;
