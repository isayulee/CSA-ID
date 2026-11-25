-- On top of seed-0002.sql, once migrations 0003 and 0004 are applied, for rehearse.sh only.
UPDATE profiles SET student_number = '2020000001', show_student_number = 1, appearance = '{"theme":"dark;''quoted''"}' WHERE id = 'p1';
UPDATE published_profiles SET student_number = '2020000001', show_student_number = 1 WHERE profile_id = 'p1';

INSERT INTO admin_audit_log (id, actor_google_sub, action, target_profile_id, target_slug, reason, created_at) VALUES
  ('l1', '100000000000000000006', 'suspend', 'p4', 'dan-oneil', 'The link isn''t safe;' || char(10) || 'asked twice.', 1762400000),
  ('l2', '100000000000000000006', 'resolve_report', 'gone', NULL, 'Reviewed.', 1762400100);
