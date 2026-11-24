-- PROTOTYPE, wipe me. Cutover part 3 of 3: load the staged rows into the fresh tables, parent-first,
-- applying each transform decided on the map (#85 Profile, #86 accounts, #87 audit log), then
-- record the fresh 0000 as the only applied migration.

-- users (#86): picture_url dropped; a missing or "Student assistant" name becomes the email prefix.
-- age_confirmed_at: every live User passed the sign-in page's "you confirm you are at least 18"
-- (on the page since the first commit), so their sign-up time is recorded.
INSERT INTO users (id, google_sub, email, name, age_confirmed_at, created_at)
SELECT id, google_sub, email,
  CASE WHEN trim(name) = '' OR name = 'Student assistant'
       THEN coalesce(nullif(substr(email, 1, instr(email, '@') - 1), ''), substr(email, 1, 128))
       ELSE substr(name, 1, 128) END,
  coalesce(age_confirmed_at, created_at),
  created_at
FROM old_users;

-- reserved_slugs (#86): Slug + time, profile_id dropped. The UNION is a safety net: the new foreign key
-- from profiles.slug would reject a Profile whose Slug was somehow never reserved.
INSERT INTO reserved_slugs (slug, reserved_at)
SELECT slug, created_at FROM old_reserved_slugs
UNION
SELECT slug, created_at FROM old_profiles
WHERE slug IS NOT NULL AND slug NOT IN (SELECT slug FROM old_reserved_slugs);

-- profiles (#85): role -> role_title (the old "Student assistant" default becomes "Peer Adviser"),
-- appearance JSON -> four columns, http:// evaluation links upgraded to https://, empty student number -> null.
INSERT INTO profiles (id, user_id, slug, status, display_name, role_title, bio, accent_color,
  icon_color, card_color, card_opacity, card_frosted, avatar_key, background_key,
  evaluation_url, student_number, show_student_number, terms_version, terms_accepted_at, created_at, updated_at)
SELECT id, user_id, slug, status, substr(display_name, 1, 128),
  CASE WHEN role = 'Student assistant' THEN 'Peer Adviser' ELSE substr(role, 1, 128) END,
  substr(bio, 1, 500), upper(accent_color),
  json_extract(appearance, '$.iconColor'), json_extract(appearance, '$.cardColor'),
  json_extract(appearance, '$.cardOpacity'),
  CASE WHEN appearance IS NULL THEN NULL WHEN json_extract(appearance, '$.frosted') THEN 1 ELSE 0 END,
  avatar_key, background_key,
  CASE WHEN evaluation_url GLOB 'http://*' THEN 'https://' || substr(evaluation_url, 8) ELSE nullif(evaluation_url, '') END,
  nullif(student_number, ''), show_student_number, NULL, NULL, created_at, updated_at
FROM old_profiles;

INSERT INTO draft_social_links (id, profile_id, service, url, display_order)
SELECT id, profile_id, service, url, display_order FROM old_draft_social_links;

-- published_profiles (#85): same transforms as the draft.
INSERT INTO published_profiles (profile_id, slug, display_name, role_title, bio, accent_color,
  icon_color, card_color, card_opacity, card_frosted, avatar_key, background_key,
  evaluation_url, student_number, show_student_number, published_at)
SELECT profile_id, slug, display_name,
  CASE WHEN role = 'Student assistant' THEN 'Peer Adviser' ELSE role END,
  bio, upper(accent_color),
  json_extract(appearance, '$.iconColor'), json_extract(appearance, '$.cardColor'),
  json_extract(appearance, '$.cardOpacity'),
  CASE WHEN appearance IS NULL THEN NULL WHEN json_extract(appearance, '$.frosted') THEN 1 ELSE 0 END,
  avatar_key, background_key,
  CASE WHEN evaluation_url GLOB 'http://*' THEN 'https://' || substr(evaluation_url, 8) ELSE evaluation_url END,
  student_number, show_student_number, published_at
FROM old_published_profiles;

INSERT INTO published_social_links (id, profile_id, service, url, display_order)
SELECT id, profile_id, service, url, display_order FROM old_published_social_links;

-- abuse_reports (#86): slug filled from the Profile; stays null where the Profile was already deleted.
INSERT INTO abuse_reports (id, profile_id, slug, reason, details, status, created_at)
SELECT r.id, r.profile_id, p.slug, r.reason, substr(r.details, 1, 1000), r.status, r.created_at
FROM old_abuse_reports r LEFT JOIN old_profiles p ON p.id = r.profile_id;

-- admin_audit_log (#87): every live entry targets a Profile.
INSERT INTO admin_audit_log (id, actor_google_sub, action, target_type, target_id, target_label, reason, created_at)
SELECT id, actor_google_sub, action, 'profile', target_profile_id, coalesce(target_slug, ''), reason, created_at
FROM old_admin_audit_log;

-- The fresh 0000 is now the only applied migration, so `wrangler d1 migrations apply` sees nothing pending.
DELETE FROM d1_migrations;
INSERT INTO d1_migrations (name) VALUES ('0000_fresh_schema.sql');
