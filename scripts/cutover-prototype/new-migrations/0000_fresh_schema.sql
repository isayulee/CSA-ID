-- PROTOTYPE, wipe me. A hand-built stand-in for the fresh 0000 that drizzle-kit will generate.
-- Tables, checks and indexes are copied verbatim from the spec (agent_technical_readme.md §6 and §14.3,
-- pull request #94). Triggers and seed rows are appended by hand, as the migration rules require.

-- (length(c) = 7 and c glob '#*' and substr(c, 2) not glob '*[^0-9A-Fa-f]*') stands for (length(c) = 7 and c glob '#*' and substr(c, 2) not glob '*[^0-9A-Fa-f]*').
-- One glob of six character classes would be clearer, but D1 rejects GLOB patterns over 50 bytes.

-- Root of every cascade: keep checks few and certain.
create table users (
  id text primary key,
  google_sub text not null unique,
  email text not null check (length(email) <= 320),
  name text not null check (length(name) between 1 and 128),  -- Google's name (or the email prefix), refreshed at sign-in
  age_confirmed_at integer,                                    -- set when the account is created (section 4)
  created_at integer not null default (unixepoch())
);

create table sessions (
  token_hash text primary key check (length(token_hash) = 64),  -- SHA-256 hex of the cookie token
  user_id text not null references users(id) on delete cascade,
  expires_at integer not null,
  created_at integer not null default (unixepoch())
);

-- Outlives every Profile so a Slug can never be reused. Nothing deletes from it.
create table reserved_slugs (
  slug text primary key check (
    length(slug) between 3 and 64
    and slug not glob '*[^a-z0-9-]*'
    and slug not glob '-*' and slug not glob '*-' and slug not glob '*--*'
  ),
  reserved_at integer not null default (unixepoch())
);

create table profiles (
  id text primary key,
  user_id text not null unique references users(id) on delete cascade,
  slug text unique references reserved_slugs(slug),            -- no cascade
  status text not null default 'draft' check (status in ('draft', 'published', 'suspended')),

  -- Editable draft fields
  display_name text not null default '' check (length(display_name) <= 128),
  role_title text not null default '' check (length(role_title) <= 128),
  bio text not null default '' check (length(bio) <= 500),
  accent_color text not null default '#B5121B' check ((length(accent_color) = 7 and accent_color glob '#*' and substr(accent_color, 2) not glob '*[^0-9A-Fa-f]*')),
  icon_color text check (icon_color is null or (length(icon_color) = 7 and icon_color glob '#*' and substr(icon_color, 2) not glob '*[^0-9A-Fa-f]*')),
  card_color text check (card_color is null or (length(card_color) = 7 and card_color glob '#*' and substr(card_color, 2) not glob '*[^0-9A-Fa-f]*')),
  card_opacity integer check (card_opacity is null or card_opacity between 70 and 100),
  card_frosted integer check (card_frosted is null or card_frosted in (0, 1)),
  avatar_key text,
  background_key text,
  evaluation_url text check (evaluation_url is null or (evaluation_url glob 'https://*' and length(evaluation_url) <= 500)),  -- null = the shared CSA form
  student_number text check (student_number is null or (length(student_number) between 1 and 32 and student_number not glob '*[^0-9]*')),
  show_student_number integer not null default 0 check (show_student_number in (0, 1)),

  terms_version text check (terms_version is null or length(terms_version) between 1 and 32),
  terms_accepted_at integer,
  created_at integer not null default (unixepoch()),
  updated_at integer not null default (unixepoch()),
  check ((icon_color is null) = (card_color is null)
     and (card_color is null) = (card_opacity is null)
     and (card_opacity is null) = (card_frosted is null)),   -- all four or none; none = theme default
  check ((terms_version is null) = (terms_accepted_at is null))
);

create table draft_social_links (
  id text primary key,
  profile_id text not null references profiles(id) on delete cascade,
  service text not null check (service in ('linkedin', 'instagram', 'facebook', 'github', 'youtube', 'tiktok', 'x', 'website')),
  url text not null check (url glob 'https://*' and length(url) <= 500),
  display_order integer not null check (display_order between 0 and 9),
  unique (profile_id, service),
  unique (profile_id, display_order)
);

-- A separate snapshot prevents draft edits from leaking publicly. Only publish writes it,
-- copying from the checked draft, so it has no checks of its own.
create table published_profiles (
  profile_id text primary key references profiles(id) on delete cascade,
  slug text not null unique references reserved_slugs(slug),   -- no cascade
  display_name text not null,
  role_title text not null,
  bio text not null,
  accent_color text not null,
  icon_color text,
  card_color text,
  card_opacity integer,
  card_frosted integer,
  avatar_key text,
  background_key text,
  evaluation_url text not null,          -- resolved: the CSA form when the draft has none
  student_number text,                   -- only when the CSA form is used or the Peer Adviser shows it
  show_student_number integer not null default 0,
  published_at integer not null default (unixepoch())
);

create table published_social_links (
  id text primary key,
  profile_id text not null references published_profiles(profile_id) on delete cascade,
  service text not null check (service in ('linkedin', 'instagram', 'facebook', 'github', 'youtube', 'tiktok', 'x', 'website')),
  url text not null check (url glob 'https://*' and length(url) <= 500),
  display_order integer not null check (display_order between 0 and 9),
  unique (profile_id, service),
  unique (profile_id, display_order)
);

-- Anonymous: no reporter contact. Who closed a report, and when, is in the audit log.
create table abuse_reports (
  id text primary key,
  profile_id text references profiles(id) on delete set null,
  slug text references reserved_slugs(slug),   -- set on every new report; null only for pre-cutover reports whose Profile was already deleted
  reason text not null check (reason in ('impersonation', 'malicious-link', 'prohibited-content')),
  details text not null default '' check (length(details) <= 1000),
  status text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),  -- resolved: action taken; dismissed: nothing wrong
  created_at integer not null default (unixepoch())
);

-- Append-only; actor and target are plain values, not foreign keys, so entries survive
-- account and content deletion. target_label never holds a name or an email address.
create table admin_audit_log (
  id text primary key,
  actor_google_sub text not null,
  action text not null check (action in (
    'suspend', 'unsuspend', 'remove_images',
    'resolve_report', 'dismiss_report',
    'approve_peer_adviser', 'revoke_peer_adviser', 'update_peer_adviser',
    'assign_advising_request',
    'approve_kit_draft', 'reject_kit_draft',
    'update_course', 'merge_course', 'delete_course',
    'add_campus'
  )),
  target_type text not null check (target_type in (
    'profile', 'abuse_report', 'user', 'advising_request', 'kit_version', 'course', 'campus'
  )),
  target_id text not null check (length(target_id) between 1 and 64),
  target_label text not null default '' check (length(target_label) <= 128),  -- e.g. the Slug, 'MATH146-0 → MATH146', 'Makati'
  reason text check (reason is null or length(reason) between 1 and 1000),
  created_at integer not null default (unixepoch()),
  check (target_type = case
    when action in ('suspend', 'unsuspend', 'remove_images') then 'profile'
    when action in ('resolve_report', 'dismiss_report') then 'abuse_report'
    when action in ('approve_peer_adviser', 'revoke_peer_adviser', 'update_peer_adviser') then 'user'
    when action = 'assign_advising_request' then 'advising_request'
    when action in ('approve_kit_draft', 'reject_kit_draft') then 'kit_version'
    when action in ('update_course', 'merge_course', 'delete_course') then 'course'
    when action = 'add_campus' then 'campus'
  end)
);

create index users_email_idx on users(email);                 -- Administrators find a User to approve
create index sessions_user_id_idx on sessions(user_id);
create index sessions_expires_at_idx on sessions(expires_at);
create index abuse_reports_profile_idx on abuse_reports(profile_id, created_at);
create index abuse_reports_created_idx on abuse_reports(created_at);
create index admin_audit_log_target_idx on admin_audit_log(target_type, target_id, created_at);

-- Shared reference data. A list that may grow lives in a table, never in a check,
-- because changing a check later rebuilds every table that carries it.
create table campuses (
  id text primary key check (length(id) between 2 and 32 and id not glob '*[^a-z0-9-]*'),  -- e.g. intramuros
  name text not null unique check (length(name) between 1 and 64),                          -- e.g. Intramuros
  created_at integer not null default (unixepoch())
);
-- The fresh 0000 seeds ('intramuros', 'Intramuros') and ('makati', 'Makati'),
-- to be confirmed against the intake form's campus options.

create table courses (
  code text primary key check (
    length(code) between 2 and 16
    and code glob '[A-Z]*'               -- starts with a letter
    and code not glob '*[^A-Z0-9-]*'     -- uppercase letters, digits, hyphen
    and code not glob '*-'               -- no trailing hyphen
  ),                                     -- e.g. MATH146, CHM11-3L
  title text not null check (length(title) between 1 and 128),
  created_by_user_id text references users(id) on delete set null,
  created_at integer not null default (unixepoch())
);

-- A row means approved. Revoking deletes it.
create table peer_advisers (
  user_id text primary key references users(id) on delete cascade,
  campus_id text not null references campuses(id) on delete restrict,
  officer_position text check (officer_position is null or length(officer_position) between 1 and 64),
  officer_order integer check (officer_order is null or officer_order between 1 and 99),  -- order in the Directory
  approved_at integer not null default (unixepoch()),
  check ((officer_position is null) = (officer_order is null))
);

create table peer_adviser_courses (
  user_id text not null references peer_advisers(user_id) on delete cascade,
  course_code text not null references courses(code) on update cascade on delete restrict,
  primary key (user_id, course_code)
);

-- One row per free hour; weekday 1 = Monday ... 6 = Saturday; hour 8 = 08:00-09:00 ... 16 = 16:00-17:00.
create table peer_adviser_availability (
  user_id text not null references peer_advisers(user_id) on delete cascade,
  weekday integer not null check (weekday between 1 and 6),
  hour integer not null check (hour between 8 and 16),
  primary key (user_id, weekday, hour)
);

create table teaching_kits (
  id text primary key,
  course_code text not null references courses(code) on update cascade on delete restrict,
  academic_year integer not null check (academic_year between 2000 and 2100),  -- starting year: 2026 = AY 2026-2027
  term integer not null check (term between 1 and 4),
  current_version_id text references kit_versions(id) on delete restrict,       -- null until the first approval; set only by the approve batch
  created_at integer not null default (unixepoch()),
  unique (course_code, academic_year, term)
);

-- A Kit Draft is a row with status 'pending'. Approved and rejected rows are never edited again.
create table kit_versions (
  id text primary key,
  kit_id text not null references teaching_kits(id) on delete cascade,
  base_version_id text references kit_versions(id) on delete set null,  -- the approved version it was written against; null for a new kit
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  title text not null check (length(title) between 1 and 128),
  body text not null default '' check (length(body) <= 20000),          -- Markdown, rendered without raw HTML
  author_user_id text references users(id) on delete set null,
  review_note text check (review_note is null or length(review_note) between 1 and 1000),
  created_at integer not null default (unixepoch()),
  updated_at integer not null default (unixepoch()),
  reviewed_at integer,
  check ((status = 'pending') = (reviewed_at is null)),
  check (status != 'rejected' or review_note is not null)
);

-- One row per stored PDF; several versions may point at the same file.
create table kit_files (
  id text primary key,
  kv_key text not null unique,           -- kit/<file id>.pdf, never a user-supplied name
  size_bytes integer not null check (size_bytes between 1 and 5242880),
  uploaded_by_user_id text references users(id) on delete set null,
  created_at integer not null default (unixepoch())
);

create table kit_items (
  id text primary key,
  version_id text not null references kit_versions(id) on delete cascade,
  kind text not null check (kind in ('pdf', 'drive', 'youtube')),
  label text not null check (length(label) between 1 and 128),
  url text check (url is null or (url glob 'https://*' and length(url) <= 500)),  -- drive and youtube
  file_id text references kit_files(id) on delete restrict,                          -- pdf
  display_order integer not null check (display_order between 0 and 49),
  check ((kind = 'pdf') = (file_id is not null)),
  check ((kind = 'pdf') = (url is null)),
  unique (version_id, display_order)
);

create table advising_requests (
  id text primary key,
  intake_key text not null unique check (length(intake_key) = 64),   -- SHA-256 hex of the form's Timestamp and Email Address; makes intake idempotent
  submitted_at integer not null,                                      -- the form's Timestamp
  campus_text text not null check (length(campus_text) <= 100),       -- as answered
  campus_id text references campuses(id) on delete restrict,          -- matched; null until a person fixes it
  course_text text not null check (length(course_text) <= 200),       -- as typed, e.g. "Calculus 1/MATH146"
  course_code text references courses(code) on update cascade on delete restrict,  -- parsed; null until a person picks it
  topic text not null default '' check (length(topic) <= 2000),
  attendee_count integer not null default 1 check (attendee_count between 1 and 50),
  available_day_text text not null default '' check (length(available_day_text) <= 500),
  available_time_text text not null default '' check (length(available_time_text) <= 500),
  times_unclear integer not null default 0 check (times_unclear in (0, 1)),
  status text not null default 'pending' check (status in (
    'pending', 'rescheduled', 'done', 'cancelled',
    'no_peer_adviser_available', 'no_response_from_advisee'
  )),
  claimed_by_user_id text references users(id) on delete set null,
  claimed_at integer,                    -- meaningful only while claimed; no paired check, or deleting the claimant's account would fail
  scheduled_on text check (scheduled_on is null or scheduled_on glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  scheduled_start text check (scheduled_start is null or scheduled_start glob '[0-2][0-9]:[0-5][0-9]'),
  sheet_peer_adviser text check (sheet_peer_adviser is null or length(sheet_peer_adviser) <= 200),  -- imported rows only: the Sheet's Peer Adviser text
  sheet_remarks text check (sheet_remarks is null or length(sheet_remarks) <= 2000),                -- imported rows only: the full Remarks text
  created_at integer not null default (unixepoch()),
  updated_at integer not null default (unixepoch()),
  check (scheduled_start is null or scheduled_on is not null)
);

-- Personal data lives apart so a retention job can delete these rows and keep the request counts.
create table advisee_contacts (
  request_id text primary key references advising_requests(id) on delete cascade,
  full_name text not null check (length(full_name) between 1 and 200),
  student_number text not null check (length(student_number) <= 32),
  program_year text not null default '' check (length(program_year) <= 64),
  email text not null check (length(email) <= 320),
  cardinal_mail text not null check (length(cardinal_mail) <= 320)
);

-- Parsed or hand-set free time. weekday is always set: a dated slot stores its date's weekday.
-- on_date '' means every week. The primary key stops duplicate slots.
create table advising_request_slots (
  request_id text not null references advising_requests(id) on delete cascade,
  weekday integer not null check (weekday between 1 and 6),
  on_date text not null default '' check (on_date = '' or on_date glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  hour integer not null check (hour between 8 and 16),
  primary key (request_id, weekday, on_date, hour)
);

-- Append-only, enforced in code. No triggers, so a retention job can still delete notes.
create table advising_notes (
  id text primary key,
  request_id text not null references advising_requests(id) on delete cascade,
  author_user_id text references users(id) on delete set null,
  body text not null check (length(body) between 1 and 2000),
  created_at integer not null default (unixepoch())
);

create index peer_advisers_campus_idx on peer_advisers(campus_id);
create index peer_adviser_courses_course_idx on peer_adviser_courses(course_code);   -- who tutors a Course
create unique index kit_versions_one_pending_per_author on kit_versions(kit_id, author_user_id) where status = 'pending';
create index kit_versions_kit_idx on kit_versions(kit_id, status);
create index kit_versions_pending_idx on kit_versions(created_at) where status = 'pending';  -- the review queue
create index kit_items_file_idx on kit_items(file_id);
create index advising_requests_status_idx on advising_requests(status, submitted_at);
create index advising_requests_claimed_idx on advising_requests(claimed_by_user_id, status);
create index advising_notes_request_idx on advising_notes(request_id, created_at);

-- Triggers (hand-written; drizzle-kit can't express them). Same bodies as migrations 0001 and 0003.
CREATE TRIGGER profiles_updated_at AFTER UPDATE ON profiles
BEGIN
  UPDATE profiles SET updated_at = unixepoch() WHERE id = NEW.id;
END;

CREATE TRIGGER profiles_slug_immutable BEFORE UPDATE OF slug ON profiles
WHEN OLD.slug IS NOT NULL AND NEW.slug IS NOT OLD.slug
BEGIN
  SELECT RAISE(ABORT, 'profile slug is permanent');
END;

CREATE TRIGGER admin_audit_log_no_update BEFORE UPDATE ON admin_audit_log
BEGIN
  SELECT RAISE(ABORT, 'admin audit log is append-only');
END;

CREATE TRIGGER admin_audit_log_no_delete BEFORE DELETE ON admin_audit_log
BEGIN
  SELECT RAISE(ABORT, 'admin audit log is append-only');
END;

-- Seed rows (to be confirmed against the intake form's campus options).
INSERT INTO campuses (id, name) VALUES ('intramuros', 'Intramuros'), ('makati', 'Makati');
