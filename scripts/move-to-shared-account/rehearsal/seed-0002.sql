-- Fake data for the database at migration 0002, for rehearse.sh only. seed-0004.sql adds what 0004, live's level, has.
-- Six Peer Advisers; p1's Slug is on an NFC Card. Text includes newlines, apostrophes, accents and emoji
-- so the export and import are checked byte for byte.

INSERT INTO users (id, google_sub, email, name, picture_url, age_confirmed_at, created_at) VALUES
  ('u1', '100000000000000000001', 'ana@example.test',   'Ana Reyes',     'https://example.test/a.png', NULL, 1762000000),
  ('u2', '100000000000000000002', 'ben@example.test',   'Ben Cruz',      NULL,                         NULL, 1762000100),
  ('u3', '100000000000000000003', 'cara@example.test',  'Cara Mapúa',    NULL,                         NULL, 1762000200),
  ('u4', '100000000000000000004', 'dan@example.test',   'Dan O''Neil',   NULL,                         NULL, 1762000300),
  ('u5', '100000000000000000005', 'eve@example.test',   'Eve Santos',    NULL,                         NULL, 1762000400),
  ('u6', '100000000000000000006', 'fay@example.test',   'Student assistant', NULL,                     NULL, 1762000500);

INSERT INTO profiles (id, user_id, slug, display_name, role, bio, accent_color, avatar_key, background_key, evaluation_url, status, created_at, updated_at) VALUES
  ('p1', 'u1', 'ana-reyes', 'Ana Reyes', 'Peer Adviser',
     'Calculus 1 and 2.' || char(10) || 'Ask me about limits — it''s fine! 🙂', '#B5121B',
     'img/p1/avatar/11111111-1111-4111-8111-111111111111.webp', 'img/p1/background/22222222-2222-4222-8222-222222222222.webp',
     'https://forms.example.test/ana', 'published', 1762000000, 1762100000),
  ('p2', 'u2', 'ben-cruz', 'Ben Cruz', 'Student assistant', '', '#1D4ED8',
     'img/p2/avatar/33333333-3333-4333-8333-333333333333.webp', NULL, NULL, 'published', 1762000100, 1762100100),
  ('p3', 'u3', 'cara', 'Cara Mapúa', 'Officer · Secretary', 'Physics.', '#B5121B', NULL, NULL, NULL, 'draft', 1762000200, 1762100200),
  ('p4', 'u4', 'dan-oneil', 'Dan O''Neil', 'Peer Adviser', 'Chemistry', '#B5121B', NULL, NULL, 'http://forms.example.test/dan', 'suspended', 1762000300, 1762100300),
  ('p5', 'u5', NULL, 'Eve Santos', 'Student assistant', '', '#B5121B', NULL, NULL, NULL, 'draft', 1762000400, 1762000400),
  ('p6', 'u6', 'fay', 'Fay', 'Peer Adviser', 'Statistics', '#B5121B', NULL, NULL, NULL, 'published', 1762000500, 1762100500);

-- 'old-card' belonged to an account that was deleted: the reservation stays, with no Profile.
INSERT INTO reserved_slugs (slug, profile_id, created_at) VALUES
  ('ana-reyes', 'p1', 1762000010), ('ben-cruz', 'p2', 1762000110), ('cara', 'p3', 1762000210),
  ('dan-oneil', 'p4', 1762000310), ('fay', 'p6', 1762000510), ('old-card', NULL, 1761000000);

INSERT INTO draft_social_links (id, profile_id, service, url, display_order) VALUES
  ('d1', 'p1', 'linkedin', 'https://www.linkedin.com/in/ana', 0),
  ('d2', 'p1', 'github', 'https://github.com/ana', 1),
  ('d3', 'p2', 'instagram', 'https://www.instagram.com/ben', 0);

INSERT INTO published_profiles (profile_id, slug, display_name, role, bio, accent_color, avatar_key, background_key, evaluation_url, published_at) VALUES
  ('p1', 'ana-reyes', 'Ana Reyes', 'Peer Adviser',
     'Calculus 1 and 2.' || char(10) || 'Ask me about limits — it''s fine! 🙂', '#B5121B',
     'img/p1/avatar/11111111-1111-4111-8111-111111111111.webp', 'img/p1/background/22222222-2222-4222-8222-222222222222.webp',
     'https://forms.example.test/ana', 1762100000),
  ('p2', 'ben-cruz', 'Ben Cruz', 'Student assistant', '', '#1D4ED8',
     'img/p2/avatar/33333333-3333-4333-8333-333333333333.webp', NULL, 'https://forms.example.test/csa', 1762100100),
  ('p6', 'fay', 'Fay', 'Peer Adviser', 'Statistics', '#B5121B', NULL, NULL, 'https://forms.example.test/csa', 1762100500);

INSERT INTO published_social_links (id, profile_id, service, url, display_order) VALUES
  ('s1', 'p1', 'linkedin', 'https://www.linkedin.com/in/ana', 0),
  ('s2', 'p2', 'instagram', 'https://www.instagram.com/ben', 0);

-- Sessions must NOT reach the shared account.
INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES
  ('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'u1', 1799999999, 1762200000),
  ('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'u2', 1799999999, 1762200100);

-- r2's Profile was deleted before the move, so its profile_id is already null.
INSERT INTO abuse_reports (id, profile_id, reason, details, status, created_at) VALUES
  ('r1', 'p4', 'malicious-link', 'The evaluation link goes somewhere odd.', 'resolved', 1762300000),
  ('r2', NULL, 'impersonation', '', 'open', 1762300100),
  ('r3', 'p2', 'prohibited-content', 'It''s "quoted"; `ticked`' || char(13) || char(10) ||
     'PRAGMA defer_foreign_keys=TRUE;' || char(10) || 'INSERT INTO "users" VALUES(''x''); -- /* ; DROP TABLE users; \n', 'open', 1762300200);
