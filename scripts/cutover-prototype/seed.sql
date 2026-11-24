-- PROTOTYPE, wipe me. Fake data shaped like the live database (about 6 Profiles, one Slug on an NFC Card),
-- written against the OLD schema (migrations 0000-0004). Every person here is invented.

INSERT INTO users (id, google_sub, email, name, picture_url, age_confirmed_at, created_at) VALUES
  ('u1', 'sub-1', 'proto.one@example.com',   'Proto Adviser One',   'https://lh3.example.com/a.png', NULL, 1762800000),
  ('u2', 'sub-2', 'proto.two@example.com',   'Proto Adviser Two',   NULL,                            NULL, 1762810000),
  ('u3', 'sub-3', 'proto.three@example.com', 'Proto Adviser Three', NULL,                            NULL, 1762820000),
  ('u4', 'sub-4', 'proto.four@example.com',  'Proto Adviser Four',  NULL,                            NULL, 1762830000),
  ('u5', 'sub-5', 'proto.five@example.com',  'Proto Adviser Five',  NULL,                            NULL, 1762840000),
  ('u6', 'sub-6', 'proto.six@example.com',   'Student assistant',   NULL,                            NULL, 1762850000);

-- p1: published, Slug on an NFC Card, the old "Student assistant" default role, custom appearance, CSA form.
-- p2: published, an http:// evaluation link (the old Zod allowed it).
-- p3: published, frosted card, its own role.
-- p4: draft with a claimed Slug, never published.
-- p5: suspended (snapshot removed), Slug kept.
-- p6: draft, no Slug yet.
INSERT INTO profiles (id, user_id, slug, display_name, role, bio, accent_color, avatar_key, background_key, evaluation_url, student_number, show_student_number, appearance, status, created_at, updated_at) VALUES
  ('p1', 'u1', 'proto-card',  'Proto One',   'Student assistant',       'Tutors calculus.', '#B5121B', 'img/p1/avatar/v1.webp', NULL, NULL, '2021100001', 0, '{"iconColor":"#78121A","cardColor":"#FFFDF8","cardOpacity":90,"frosted":false}', 'published', 1762800100, 1762900000),
  ('p2', 'u2', 'proto-two',   'Proto Two',   'Peer Adviser',            '',                 '#123ABC', NULL, NULL, 'http://forms.example.com/eval-two', NULL, 0, NULL, 'published', 1762810100, 1762900100),
  ('p3', 'u3', 'proto-three', 'Proto Three', 'Peer Adviser, Physics',   'Physics and labs.', '#0A7A3C', NULL, 'img/p3/background/v2.webp', 'https://forms.example.com/eval-three', '2022100003', 1, '{"iconColor":"#000000","cardColor":"#222222","cardOpacity":75,"frosted":true}', 'published', 1762820100, 1762900200),
  ('p4', 'u4', 'proto-four',  'Proto Four',  'Student assistant',       '',                 '#B5121B', NULL, NULL, NULL, NULL, 0, NULL, 'draft', 1762830100, 1762830100),
  ('p5', 'u5', 'proto-five',  'Proto Five',  'Peer Adviser',            'Suspended one.',   '#B5121B', NULL, NULL, NULL, '2020100005', 0, NULL, 'suspended', 1762840100, 1762950000),
  ('p6', 'u6', NULL,          '',            'Student assistant',       '',                 '#B5121B', NULL, NULL, NULL, NULL, 0, NULL, 'draft', 1762850100, 1762850100);

-- One reservation per claimed Slug, plus one left by a deleted account (profile_id already null).
INSERT INTO reserved_slugs (slug, profile_id, created_at) VALUES
  ('proto-card', 'p1', 1762800200),
  ('proto-two', 'p2', 1762810200),
  ('proto-three', 'p3', 1762820200),
  ('proto-four', 'p4', 1762830200),
  ('proto-five', 'p5', 1762840200),
  ('proto-gone', NULL, 1762700000);

INSERT INTO draft_social_links (id, profile_id, service, url, display_order) VALUES
  ('d1', 'p1', 'linkedin', 'https://www.linkedin.com/in/proto-one', 0),
  ('d2', 'p1', 'instagram', 'https://www.instagram.com/proto.one', 1),
  ('d3', 'p3', 'github', 'https://github.com/proto-three', 0),
  ('d4', 'p3', 'website', 'https://proto-three.example.com', 1),
  ('d5', 'p4', 'tiktok', 'https://www.tiktok.com/@proto.four', 0);

INSERT INTO published_profiles (profile_id, slug, display_name, role, bio, accent_color, avatar_key, background_key, evaluation_url, student_number, show_student_number, appearance, published_at) VALUES
  ('p1', 'proto-card', 'Proto One', 'Student assistant', 'Tutors calculus.', '#B5121B', 'img/p1/avatar/v1.webp', NULL, 'https://forms.gle/y1EeQ5sQoAY2W9fq7', '2021100001', 0, '{"iconColor":"#78121A","cardColor":"#FFFDF8","cardOpacity":90,"frosted":false}', 1762900000),
  ('p2', 'proto-two', 'Proto Two', 'Peer Adviser', '', '#123ABC', NULL, NULL, 'http://forms.example.com/eval-two', NULL, 0, NULL, 1762900100),
  ('p3', 'proto-three', 'Proto Three', 'Peer Adviser, Physics', 'Physics and labs.', '#0A7A3C', NULL, 'img/p3/background/v2.webp', 'https://forms.example.com/eval-three', '2022100003', 1, '{"iconColor":"#000000","cardColor":"#222222","cardOpacity":75,"frosted":true}', 1762900200);

INSERT INTO published_social_links (id, profile_id, service, url, display_order) VALUES
  ('s1', 'p1', 'linkedin', 'https://www.linkedin.com/in/proto-one', 0),
  ('s2', 'p1', 'instagram', 'https://www.instagram.com/proto.one', 1),
  ('s3', 'p3', 'github', 'https://github.com/proto-three', 0);

INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES
  ('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'u1', 1999999999, 1762900000),
  ('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'u3', 1999999999, 1762900000),
  ('cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc', 'u6', 1000000000, 1762850200);

INSERT INTO abuse_reports (id, profile_id, reason, details, status, created_at) VALUES
  ('r1', 'p5', 'malicious-link', 'The website link looks like phishing.', 'open', 1762940000),
  ('r2', NULL, 'impersonation', 'Report about an account that was later deleted.', 'open', 1762710000);

INSERT INTO admin_audit_log (id, actor_google_sub, action, target_profile_id, target_slug, reason, created_at) VALUES
  ('a1', 'sub-admin', 'suspend', 'p5', 'proto-five', 'Phishing link on the Profile', 1762950000);
