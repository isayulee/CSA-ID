# Digital Profile System - Agent Technical README

This document is the implementation contract for the public Digital Profile and its management dashboard. Use the canonical domain language in [`GLOSSARY.md`](./GLOSSARY.md).

## 1. Product Boundary

The product is a public identity page that can optionally be opened from an NFC card. NFC is an access method, not a managed domain entity.

- One Google-authenticated **User** owns exactly one **Profile**.
- A Profile has one permanent **Slug** and public URL: `/id/<slug>`.
- Registration is open to any eligible Google user; there is no invitation allowlist.
- The system does not register, activate, transfer, revoke, or inventory NFC cards.
- A physical NFC card contains only the Profile URL and is programmed separately with a phone application.
- Published content is user-provided and is not identity-verified.
- The **Portal** is a private workspace inside the same app for approved **Peer Advisers**: Teaching Kits, the Peer Advising Scheduler, Matching, and the Directory. Section 14 specifies it.

### Lifecycle

Profiles use explicit states:

- `draft`: visible only to the owner.
- `published`: the current published snapshot is publicly readable.
- `suspended`: unavailable publicly because an Administrator intervened.

Edits change the Draft Profile only. Publishing validates and copies the complete draft into a separate immutable-at-rest published snapshot. Unpublishing immediately removes public access while retaining the draft. A publish may take up to 60 seconds to become visible at every cache location.

The Slug becomes permanent as soon as it is chosen. Deleted, suspended, and unpublished Slugs remain reserved so an old NFC card can never resolve to a different person.

## 2. Non-Negotiable Constraints

### Zero-billing operation

The deployed system must not depend on automatic paid overages.

- Prefer hard quota failure, degraded service, or temporary downtime over charges.
- Reject uploads and writes before application-level quotas are exceeded.
- Existing public pages should remain available from cache when dashboard or database services are restricted.
- Free-tier availability, pricing, and quotas can change. Recheck official provider documentation before every production deployment.
- The service has no commercial uptime guarantee.

“Free” does not mean unlimited. The initial target is 100-1,000 registered users and tens of thousands of monthly public-page views.

### Current domain constraint

No custom domain is currently available. Treat all provider URLs, including the `workers.dev` hostname, as temporary:

- Keep every NFC card rewritable.
- Never lock a card read-only while it contains a provider-owned hostname.
- Move to a stable custom domain before treating NFC URLs as permanent.
- Revisit production Google OAuth domain requirements before public launch.

## 3. Approved Architecture

| Responsibility | Service | Required behavior |
| --- | --- | --- |
| Web application | Next.js App Router on Cloudflare Workers Free through the OpenNext Cloudflare adapter (`@opennextjs/cloudflare`) | Static-first public pages; dynamic authenticated dashboard; compressed Worker bundle within the Free plan size limit |
| Database | Cloudflare D1 Free (SQLite), accessed only through Drizzle ORM | Schema and migrations in Drizzle; authorization enforced in server code (see section 5) |
| Authentication | Google OIDC through `oauth4webapi`, with server-side Sessions stored in D1 | Request only `openid`, `email`, and `profile`; no third-party auth service |
| Image storage | Workers KV Free | Store sanitized derivatives only; never store original uploads |
| Teaching Kit files | Workers KV Free, same namespace | PDF only, 5 MiB each, 500 MB budget for all kits; larger files and videos are Google Drive or YouTube links |
| Advising Request intake | Google Apps Script on the CSA response Sheet, owned by the CSA team | Pushes rows to the Worker with a shared secret; reads the Sheet only, and the Worker never calls Google APIs |
| Upload sanitization | Cloudflare Workers Free with the Images Free binding | Decode, resize, strip metadata, and re-encode before storage |
| Abuse challenge | Cloudflare Turnstile when risk signals trigger | Protect signup-adjacent and upload/report endpoints |
| Styling | Tailwind CSS plus validated CSS variables | Fixed layouts and allowlisted theme fields only |

Everything runs in one Worker with D1 and KV bindings. The bindings exist only inside the Worker; no database or storage credential is ever sent to the browser, and the browser never talks to D1 or KV directly.

Do not use Cloudflare R2: it requires billing enrollment and permits usage charges. Do not enable Workers Paid or any other plan that bills for overages. Do not make Vercel Hobby the production dependency for an open or potentially commercial service.

Cloudflare Images storage is not part of this architecture. Use only the free Images transformation binding and save its sanitized output to Workers KV. When the transformation quota or the KV write quota is exhausted, new uploads must fail clearly while existing assets continue to work.

D1 and KV Free quotas (rows read and written per day, KV reads and writes per day, storage size) are hard limits that fail requests rather than bill. Design reads so public traffic is served mostly from cache, and recheck the current limits in Cloudflare's documentation before every production deployment.

## 4. Authentication

### Google login

- Implement the Google OAuth authorization-code flow with `oauth4webapi`, using `state`, nonce, and PKCE.
- Request only the `openid`, `email`, and `profile` scopes.
- Verify the ID token claims (issuer, audience, expiry) and require `email_verified`.
- Identify a User by Google's subject ID (`sub`), never by email address.
- Do not implement passwords or magic links in v1.
- Store no Google access token, refresh token, or ID token. Discard them once the callback has read the claims.
- Treat Google login as proof of control of a Google identity, not proof that Profile claims are genuine.
- Ask before copying the Google display name or avatar into the Draft Profile.
- Require confirmation that the User is at least 18. The sign-in page states that continuing confirms it, and account creation records the time in `users.age_confirmed_at`.
- Require acceptance of the current Terms version before first publication; record its version and timestamp in `profiles.terms_version` and `profiles.terms_accepted_at`.

### Sessions

Sessions are implemented in application code and stored in D1.

- On sign-in, generate a session token from at least 32 cryptographically random bytes.
- Send the token only in a cookie marked `HttpOnly`, `Secure`, `SameSite=Lax`, and `Path=/`.
- Store only the SHA-256 hash of the token in the `sessions` table, with an expiry timestamp. A leaked database row must not be usable as a cookie.
- Validate a request by hashing the cookie value and looking up an unexpired row. Treat a missing, expired, or unknown token as signed out.
- Renew the expiry (sliding expiration) when a valid Session is used after half its lifetime has passed.
- Sign-out deletes the Session row and clears the cookie.
- Account deletion and administrative revocation delete every Session row of the affected User.

## 5. Authorization

D1 has no Row Level Security. Authorization is enforced in server code, and every query must follow the owner-scoping rule:

> **Owner-scoping rule:** every read or write of owner data is scoped to the User ID taken from the validated Session, never to an ID taken from the request. Owner tables filter on `user_id = <session user>`; child tables reach the owner through a join on `profiles.user_id`.

Enforce the rule through structure, not reviewer attention:

- Put all D1 access in one server-only data-access module. Route handlers, Server Actions, and Server Components call its functions and never import the Drizzle client directly.
- Owner-data functions take the authenticated User (as returned by the session check) as their first argument and apply the `user_id` filter inside the function. They accept no `user_id` or `profile_id` from the caller's request input.
- Public reads go through one function that looks up a Published Profile by Slug and returns a result only when the parent Profile's status is `published`.
- Administrative functions are separate, check the Administrator allowlist themselves, and write an audit entry in the same batch as the action.
- Writes to the Published Profile snapshot, Abuse Reports, and the audit log happen only in narrow server functions (publish, unpublish, report, suspend, delete). No generic update path reaches them.
- Every owner-data function has a test proving that User A cannot read or change User B's rows or images.

Rules the data-access layer enforces:

- A User may read and update only their own Profile, Draft Profile fields, and Draft Social Links.
- Anonymous visitors may read only a Published Profile and its Published Social Links when the parent Profile is `published`.
- Publication and unpublication execute server-side as one atomic D1 batch.
- Administrative authorization comes from a server-controlled allowlist of Google subject IDs, stored in Worker configuration. It never comes from Profile data or client-editable claims.
- The D1 and KV bindings, the Google client secret, the Turnstile secret, and the intake secret stay in the Worker and must never be exposed to the browser.
- Portal data is shared among Peer Advisers rather than owned by one User. Section 14.2 gives its access rules; every Portal function still takes the authenticated Peer Adviser from the Session and never trusts a user ID from the request.

## 6. Data Model

Use relational columns and tables for fields that require validation or ordering. Do not replace this model with unrestricted theme or social-link JSON.

Define the schema in Drizzle (`sqliteTable`) and generate migrations with `drizzle-kit`; apply them to D1 with `wrangler d1 migrations apply`. The SQL below, together with §14.3, is the baseline the migrations must produce: one fresh `0000` migration that replaces the earlier `0000` to `0004`. Add indexes, check constraints, and triggers in the same migration rather than relying on application validation alone. Moving the live data onto this schema is a separate cutover plan.

SQLite conventions used here:

- IDs are `text` UUIDs generated by the server (`crypto.randomUUID()`).
- Timestamps are `integer` Unix epoch seconds.
- A calendar date without a time is `text` `YYYY-MM-DD`, and a time of day is `text` `HH:MM` (24-hour), both in Manila time, which has no daylight saving.
- Enumerations are `text` columns with `check (... in (...))`.
- Booleans are `integer` 0 or 1.
- SQLite has no regular expressions in D1, so format checks use `length` and `glob`. The server-side Zod validation in section 7 remains the full rule.
- D1 enforces foreign keys.
- A table that other tables reference is a **parent table**. Get its checks and defaults right the first time: see "Migration rules" below for why changing them later is dangerous.

```sql
-- HEX stands for '#[0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f]'.

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
  accent_color text not null default '#B5121B' check (accent_color glob HEX),
  icon_color text check (icon_color is null or icon_color glob HEX),
  card_color text check (card_color is null or card_color glob HEX),
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
```

`profiles.user_id` and `published_profiles.slug` are already indexed by their `unique` constraints. `profiles.slug` and `published_profiles.slug` reference `reserved_slugs` without a cascade, so no Profile can hold a Slug that isn't reserved, and an accidental drop of `reserved_slugs` fails instead of emptying `profiles`.

### Required triggers and server operations

Implement and test these in migrations or in the data-access module:

1. `updated_at` trigger on `profiles` (`after update ... set updated_at = unixepoch()`).
2. Slug immutability trigger: `before update of slug on profiles` that raises an error unless the old value is `NULL`. A Slug can be chosen once and never changed.
3. Slug claim: one D1 batch that inserts into `reserved_slugs` and then sets `profiles.slug`. The `reserved_slugs` primary key makes two concurrent claims produce exactly one winner, and the foreign key from `profiles.slug` guarantees the reservation exists. Account deletion never deletes from `reserved_slugs`.
4. Append-only audit log: `before update` and `before delete` triggers on `admin_audit_log` that raise an error.
5. Publish: the server loads the owner's Profile and Draft Social Links, verifies the required fields (`display_name`, `role_title`, a chosen Slug), the student number when the CSA evaluation form is used or the number is shown, link validity, and that the status is not `suspended`. Whether publish also requires accepted Terms and age confirmation (section 4) is the owner's open decision. It then runs one D1 batch that deletes and re-inserts the `published_profiles` row and its `published_social_links`, and updates the status to `published` with a `where status != 'suspended'` guard. D1 batches are atomic; D1 has no interactive transactions, so every check that must hold at write time is repeated as a `where` guard in the batch.
6. Unpublish: one D1 batch that changes status to `draft` (`where status = 'published'`) and deletes the `published_profiles` row, which cascades to its links. The draft is kept.
7. Expired Session cleanup: the batch that creates a Session also runs `delete from sessions where expires_at < unixepoch()`. No Cron Trigger is needed.

No client-reachable endpoint may write to `published_profiles`, `published_social_links`, `abuse_reports`, or `admin_audit_log` except through the narrow server operations for publication, reports, suspension, export, and deletion.

### Migration rules

D1 ignores `PRAGMA foreign_keys = OFF` (only `PRAGMA defer_foreign_keys` works), and `DROP TABLE` on a parent table still runs its `ON DELETE CASCADE`. drizzle-kit 0.31 rebuilds a whole table (`__new_<table>`, copy, drop, rename) whenever a column's type, default or `NOT NULL`, a foreign key, or a check constraint changes, and the rebuild silently drops the table's triggers. On D1, rebuilding a parent table therefore deletes the rows of its children. Findings: the `research/d1-recreate` and `research/drizzle-squash` branches.

- **Parent tables:** `users`, `reserved_slugs`, `profiles`, `published_profiles`, and in §14.3 `campuses`, `courses`, `peer_advisers`, `teaching_kits`, `kit_versions`, `kit_files`, `advising_requests`. Never merge a generated migration that rebuilds one of these as-is: rewrite it by hand so no child row is lost, rehearse it on a copy of the data, and compare child row counts.
- **Leaf tables** (`sessions`, the two Social Link tables, `abuse_reports`, `admin_audit_log`, and in §14.3 `peer_adviser_courses`, `peer_adviser_availability`, `kit_items`, `advisee_contacts`, `advising_request_slots`, `advising_notes`) can be rebuilt without losing other rows.
- **Triggers** live only in hand-written SQL appended to the migration; drizzle-kit can't express them. Every trigger has a test. A migration that rebuilds a table with triggers (`profiles`, `admin_audit_log`) re-creates them in the same file.
- **Prefer additive changes.** A new nullable column is a plain `ALTER TABLE ADD` with no rebuild. drizzle-kit 0.31 generates two additions that fail on a table with rows, `DEFAULT (unixepoch())` and `NOT NULL` without a default, and an `ALTER TABLE ADD` with a foreign key that loses its `ON DELETE` action; fix each by hand. `npm test` runs on an empty database, so it won't catch the first two.
- **Bound parameters:** D1 allows 100 per statement. Chunk multi-row inserts to stay under it (for example 33 availability rows of 3 values, or 14 kit items of 7 values).
- **Write budget:** D1 Free allows 100,000 written rows a day, and every index adds a written row per change. Spread bulk writes (the Portal's launch import, §14.4) over several days.

## 7. Validation Rules

Apply equivalent Zod validation on the server and constraints in the database where practical.

### Profile

- `display_name`: 1-128 trimmed characters to publish; a draft may be empty.
- `role_title`: 1-128 trimmed characters to publish; a draft may be empty.
- `bio`: 0-500 characters.
- `slug`: lowercase ASCII letters, digits, and single internal hyphens; 3-64 characters; blocked-name list required.
- appearance: `card_opacity` is 70-100 and `card_frosted` is a boolean; the four card fields (`icon_color`, `card_color`, `card_opacity`, `card_frosted`) are all set or all empty.
- `evaluation_url`: an HTTPS URL of at most 500 characters, or empty for the shared CSA evaluation form.
- `student_number`: digits only, at most 32; required to publish when the CSA evaluation form is used or the number is shown.
- colors: six-digit hexadecimal values only.
- arbitrary HTML, CSS, JavaScript, embeds, and custom components are unsupported.

### Social Links

- HTTPS only.
- At most one link per supported service: LinkedIn, Instagram, Facebook, GitHub, YouTube, TikTok, X, and a website; each URL at most 500 characters.
- LinkedIn, Instagram, Facebook, GitHub, YouTube, TikTok, and X URLs must match an allowlisted canonical hostname for that service.
- `website` may use any syntactically valid public HTTPS URL.
- Reject credentials in URLs, localhost, private/reserved IP targets, and misleading Unicode hostnames.
- Render external links with safe browser attributes and show the destination hostname.

## 8. Image Upload Pipeline

Treat every upload as hostile. The browser never writes original files directly to public storage.

### Accepted input

- JPEG, PNG, or non-animated WebP only.
- Avatar input: at most 2 MB.
- Background input: at most 4 MB.
- Reject SVG, GIF, video, animated WebP, malformed files, and excessive pixel dimensions.
- Each Profile has at most one avatar and one background.

### Required flow

1. Authenticate the User and verify Profile ownership.
2. Apply per-user and per-IP rate limits; invoke Turnstile when risk signals trigger.
3. Reject missing or excessive `Content-Length`, and enforce the limit again while streaming.
4. Inspect decoded type, animation state, dimensions, and total pixel area with the Cloudflare Images binding.
5. Fully decode and re-encode without metadata:
   - avatar: crop to at most `400x400`, WebP;
   - background: fit within `1920x1080`, WebP.
6. Store only the re-encoded bytes in Workers KV under a new versioned, owner-scoped key, for example `img/<profile_id>/avatar/<random-version>.webp`, with the content type in the KV metadata.
7. Update the Draft Profile's `avatar_key` or `background_key` to the new key, scoped to the owner.
8. Delete the replaced KV key after the D1 update succeeds, unless the current Published Profile still references it; in that case delete it when the next publish, unpublish, or account deletion releases it.

Serve images from a Worker route that reads the key from KV and returns it with `Cache-Control: public, max-age=31536000, immutable`. Because every replacement writes a new key, a cached URL never shows a different image. A key that is not found returns a short-lived 404 and is never cached as immutable.

Never retain the source upload. If the Images transformation quota or the KV write quota is exhausted, return a clear quota error and leave the existing asset unchanged.

## 9. Route Responsibilities

### `GET /id/[slug]`

- Public and authentication-free.
- Read only from the Published Profile snapshot.
- Return a neutral unavailable page for missing, draft, suspended, or deleted Profiles; do not reveal which state applies.
- Emit `noindex, nofollow` until discoverability becomes an explicit opt-in feature.
- Clearly label content as user-provided and expose a report-abuse link.
- Cache at the edge with a target propagation delay of at most 60 seconds.
- Target a Lighthouse performance score above 95 on mobile and a warm-cache TTFB below 200 ms.

### `GET /login/google` and `GET /login/google/callback`

- Start the `oauth4webapi` authorization-code flow with `state`, nonce, PKCE and `prompt=select_account`, storing the state, nonce and code verifier in short-lived `HttpOnly` cookies.
- On callback, verify `state`, exchange the code, validate the ID token claims and nonce, and require `email_verified`.
- Find or create the User by Google subject ID, create a Session, set the session cookie, and redirect to the dashboard.
- Discard the Google tokens; never write them to D1, KV, logs, or cookies.

### `POST /logout`

- Delete the Session row and clear the cookie.

### `GET /dashboard`

- Require a valid Session; redirect to the login page when it is missing, expired, or unknown.
- Create one Draft Profile on first login if none exists.
- Let the User edit and preview draft fields without changing the Published Profile.
- Make Publish, Unpublish, Export JSON, and Delete Account explicit actions.
- Show publication status and the possible 60-second propagation period.

### Server mutation endpoints

- Validate origin, authentication, authorization, rate limit, and body size before parsing the full body.
- `POST /api/profile/publish`: execute the atomic publish batch and trigger cache invalidation.
- `POST /api/profile/unpublish`: remove public availability immediately and invalidate cache.
- `POST /api/uploads/avatar` and `/background`: execute the sanitization pipeline.
- `POST /api/reports`: apply abuse controls and create an Abuse Report from server code.
- `GET /api/profile/export`: return the User's Profile and Social Links as JSON.
- `DELETE /api/account`: unpublish immediately, delete every Session, keep the Slug in `reserved_slugs`, and delete the User's D1 rows and KV images. Deleting the `users` row cascades to Sessions, the Profile, and its Social Links. KV deletion must be retryable so a partial failure cannot leave orphaned images.

## 10. Administration and Abuse Handling

- The initial Administrator is the project owner.
- Profiles display no verification badge.
- The Administrator can review reports, suspend a Profile, and remove its public images.
- Suspension retains ownership and the reserved Slug.
- Record administrative actions in the append-only `admin_audit_log` table containing actor, action, target, and timestamp, written in the same D1 batch as the action. A reason is required for every action that takes something away: suspending, unsuspending, removing images, resolving or dismissing a report, revoking a Peer Adviser, rejecting a Kit Draft, and merging or deleting a Course.
- Removing public images deletes their KV keys and clears the matching keys on the Profile and Published Profile.
- Terms must prohibit impersonation, malicious links, illegal material, harassment, and infringement.

## 11. Caching and Failure Behavior

- Use versioned immutable image keys with long-lived cache headers.
- Cache Published Profile output; never cache authenticated dashboard responses publicly.
- Publishing and unpublishing must invalidate the affected Slug.
- If D1 or KV is unavailable or over quota, serve a valid cached public response where available and fail dashboard writes safely.
- If a free quota is exhausted, return a specific user-facing error; never retry in a way that creates an unbounded cost or request loop.
- Keep deployment portable enough to replace a free-tier provider whose terms change: keep D1 access behind the data-access module and Drizzle schema, and image storage behind one small storage interface.

## 12. NFC Encoding

- Chip: NTAG215 or any tag with enough capacity for the final URL.
- Record: NDEF URI.
- Payload: `https://<stable-domain>/id/<slug>`.
- Program cards outside this system with an NFC-writing phone application.
- Keep cards writable while using a temporary provider hostname.
- Lock a card read-only only after a custom domain is controlled, routing is tested, and the Slug is final.

## 13. Completion Checklist

An implementation is incomplete until all applicable checks pass:

- [ ] Google (through `oauth4webapi`) is the only v1 authentication method; no Google access, refresh, or ID tokens are persisted.
- [ ] Sessions store only a token hash in D1; expired, tampered, and signed-out Session cookies are rejected.
- [ ] The app builds and runs on Cloudflare Workers Free through OpenNext, within the Free plan bundle size limit, with no R2 or paid plan.
- [ ] One User cannot create or own a second Profile.
- [ ] A chosen Slug cannot change or be reused after deletion; two concurrent claims produce one winner.
- [ ] Draft edits never alter the current Published Profile before Publish succeeds.
- [ ] Every D1 query follows the owner-scoping rule, and tests prove User A cannot read or mutate User B's draft data or KV images.
- [ ] Anonymous users can read Published snapshots but no draft or suspended data.
- [ ] Publication and unpublication run as single atomic D1 batches and invalidate the correct cache key.
- [ ] All Social Link services enforce HTTPS and hostname rules.
- [ ] Original uploads, metadata, animation, SVG, and excessive dimensions are rejected or removed.
- [ ] Replacing an image does not leave an unbounded number of stored derivatives.
- [ ] Abuse reports are rate-limited and administrative suspension removes public access.
- [ ] Only allowlisted Administrators reach admin actions, and audit log entries cannot be updated or deleted.
- [ ] Public pages emit `noindex, nofollow`, require no login, and identify content as user-provided.
- [ ] Account deletion unpublishes immediately, ends every Session, reserves the Slug, and removes D1 personal data and KV images through a retryable step.
- [ ] Exhausting a D1, KV, Images, or Workers free quota produces bounded failure and cannot trigger paid overages.
- [ ] NFC cards remain writable until a stable custom domain exists.
- [ ] Mobile Chrome and Safari layouts, keyboard navigation, focus states, contrast, and reduced motion are verified.
- [ ] Only approved Peer Advisers and Administrators reach Portal pages and Portal endpoints (section 14).

## 14. Peer Adviser's Portal

The Portal lives in the same Worker, uses the same Google sign-in and Sessions, and stores its data in the same D1 database. It adds no Cloudflare resource and no external service. The only new configuration is one Worker secret, `INTAKE_SECRET`, which the owner sets.

### 14.1 Roles

- **User:** anyone signed in with Google. Can own a Profile. Cannot open the Portal.
- **Peer Adviser:** a User with a row in `peer_advisers`. An Administrator creates that row (approval) and deletes it (revocation). Only Peer Advisers claim or are assigned Advising Requests, appear in Matching, and appear in the Directory.
- **Officer:** a Peer Adviser whose `officer_position` is set. Display only; grants no right.
- **Administrator:** a User on the `ADMIN_GOOGLE_SUBS` allowlist (up to about five). Can open the Portal without a `peer_advisers` row and can do everything below. An Administrator who also tutors is approved as a Peer Adviser too.

### 14.2 Access rules

| Data | Peer Adviser | Administrator |
| --- | --- | --- |
| Approved Teaching Kits, Courses, Campuses, Directory | Read | Read |
| Kit Drafts | Create; read and edit their own pending drafts | Read all; approve or reject |
| Courses | Add | Add; edit a code or title; merge a duplicate; delete one that nothing uses |
| Campuses | None | Add |
| Own Campus, courses taught, Availability | Read and write | Read; change a Peer Adviser's Campus |
| Unclaimed Advising Request | Read course, campus, topic, attendee count, times, and Matching results | Read all; assign to any Peer Adviser |
| Claimed Advising Request | Full details and notes only if they claimed it; otherwise course, campus, status, and claimant name | Full details and notes |
| Status, schedule, slots, notes | Change only on requests they claimed | Change on any request |
| `peer_advisers` rows, Officer positions | None | Write |

Enforce the table in the data-access module, the same way the owner-scoping rule is enforced:

- `requirePeerAdviser()` returns the Session's User only when it has a `peer_advisers` row or is on the Administrator allowlist; otherwise the request gets a 404 for pages and a 403 for endpoints.
- Request functions that return advisee personal data take the authenticated Peer Adviser and check `claimed_by_user_id = <session user>` or the allowlist inside the function.
- Claiming is one guarded update: `set claimed_by_user_id = <session user>, claimed_at = unixepoch() where id = ? and claimed_by_user_id is null and exists (<the session user's peer_advisers row>)`. Two Peer Advisers claiming at once produce one winner. Giving a request back clears both columns, and only where the claimant is the session User.
- Approving runs one D1 batch: insert the `peer_advisers` row with its `campus_id` and write `approve_peer_adviser`.
- Revoking approval runs one D1 batch: delete the `peer_advisers` row (its courses taught and Availability cascade), set `claimed_by_user_id = null` on that User's requests whose status is `pending` or `rescheduled`, and write `revoke_peer_adviser` with a required reason. A Peer Adviser approved again re-enters their courses and Availability.
- Every Administrator action in the Portal writes an `admin_audit_log` entry (section 6) in the same batch: approve, revoke, or update a Peer Adviser (Campus, Officer position, Directory order); assign a request; approve or reject a Kit Draft; edit, merge, or delete a Course; add a Campus. A Peer Adviser's own actions are not audited. Neither are an Administrator's changes to a request's status, schedule, or notes.
- Tests prove that a non-approved User cannot read any Portal data, that Peer Adviser A cannot read the personal data or notes of a request Peer Adviser B claimed, and that Peer Adviser A cannot change B's courses or Availability.

### 14.3 Data model

These tables add to section 6. Conventions are the same.

```sql
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
```

Notes on the tables:

- **Courses:** the server stores codes uppercased with spaces removed (`math 146` becomes `MATH146`) and keeps suffixes such as `-0`, because `CHM11-3` and `CHM11-3L` are different courses. Every reference uses `on update cascade on delete restrict`, so fixing a code is one update and a Course in use can't be deleted. Merging a duplicate re-points its references, then deletes it. The list is shared by every Campus.
- **Campus:** each Peer Adviser tutors on one Campus. The Administrator sets it at approval and may change it later; the Peer Adviser may change their own on `/portal/me`.
- **Officer position:** free text plus an order. Two Officers may share a position.
- **Directory:** a Peer Adviser with a Published Profile is shown with its `display_name` and avatar and links to `/id/<slug>`. Anyone else (Draft or Suspended Profile, or no Profile) is shown with `users.name`, no photo and no link. Officers come first by `officer_order`, then everyone else by name.
- **Availability:** saving the grid is one batch that deletes the Peer Adviser's rows and inserts the new ones, chunked to D1's bound-parameter limit (section 6).
- **Advising Request claims** reference `users`, not `peer_advisers`, so revoking a Peer Adviser keeps the record of who tutored their past sessions. Only the current claimant is stored.
- **Personal data:** `advisee_contacts` and `advising_notes` are what a future retention job deletes; when is still an open product decision. `topic` and the free-text times stay on the request, because other Peer Advisers need them to decide whether to claim.

The Student's Signature answer has no column and is never stored. Account deletion deletes the User's `peer_advisers`, `peer_adviser_courses`, and `peer_adviser_availability` rows by cascade; it keeps their kit versions and notes with the author set to null, and clears them as claimant on every request they claimed.

### 14.4 Advising Request intake

The CSA intake Google Form cannot change, and the team may edit only the Peer Adviser, Scheduled Date, and Remarks columns of its response Sheet. The Apps Script reads the Sheet and pushes; it never writes to the Sheet, and the Worker never writes back.

- `POST /api/intake/advising-requests` accepts a JSON array of at most 100 rows. It does not use `guardMutation`, because the caller is a script, not a browser Session. Instead it:
  1. rejects bodies over 256 KiB before parsing;
  2. compares `Authorization: Bearer <secret>` with `INTAKE_SECRET` in constant time and returns 401 on mismatch;
  3. validates every row with Zod and drops the Student's Signature field if present; text longer than its column's limit is truncated, never rejected, so a row is never lost;
  4. writes each row as one batch: `insert ... on conflict (intake_key) do nothing`, then its contact and slots with `insert ... select ... where exists` on the new request id, so resending a row writes nothing and fails nothing.
- The campus answer is kept in `campus_text` and matched to a Campus by case-insensitive name; when nothing matches, `campus_id` stays null and a Peer Adviser or Administrator sets it by hand.
- An imported row never overwrites Portal changes. Later Sheet edits to an imported row are ignored until the product decides otherwise (see PRODUCT.md, Open Decisions); if it does, the row hash that needs is a nullable column added then.
- **Launch import:** the same script sends every existing row in batches of 100. For these rows, map the Remarks text to one of the six statuses by its first matching status phrase (case-insensitive), default to `pending`, and keep the full text in `sheet_remarks`. Keep the Peer Adviser column in `sheet_peer_adviser`; do not guess a `claimed_by_user_id` from a name. Parse Scheduled Date (`27-Aug-25`) into `scheduled_on` when it parses, and leave it null when it doesn't. One imported request writes roughly 20 to 45 rows counting its slots and index entries, so spread the launch import over several days (for example 500 rows a day) to stay inside D1's 100,000 written rows a day.
- **New rows** arrive from an installable "on form submit" trigger, plus a time-driven trigger every 15 minutes that resends the last day's rows to cover missed pushes.
- Commit the Apps Script source and its install steps under `scripts/intake/`. The CSA team installs it; the owner sets `INTAKE_SECRET` in both places.

### 14.5 Parsing the advisee's free time and course

- The course parser looks for a course code (letters followed by digits, with an optional hyphenated or letter suffix, such as `MATH146` or `CHM11-3L`) in `course_text`. It sets `course_code` when the code is on the Course list; otherwise it leaves `course_code` null, and a Peer Adviser picks the Course by hand.
- The time parser turns `available_day_text` and `available_time_text` into `advising_request_slots`. It handles weekday names and abbreviations (`Monday`, `Mon`, `MWF`, `TTh`, `Mon-Fri`), dates (`27-Aug-25`, `Aug 27`), and ranges (`1:00pm to 5:00pm`, `1-5pm`, `13:00-17:00`). Clip every range to 8:00-17:00, round partial hours outward, and drop Sundays. A dated slot stores the weekday of its date; a weekly slot has `on_date = ''`.
- When the parser cannot read either field, or reads nothing, set `times_unclear = 1`. A Peer Adviser or Administrator then sets the slots by hand in the Scheduler, which clears the flag.
- The parser is a pure function in `lib/`. Unit-test it with real anonymized examples from the Sheet, not invented ones.

### 14.6 Matching

`lib/matching.ts` is a pure function: given a request with its course, campus, and slots, plus the Peer Advisers with their courses, Campus, Availability, and open-request counts, it returns a ranked list.

1. Keep only Peer Advisers who tutor `course_code` and whose `campus_id` equals the request's `campus_id`.
2. Score each by the number of the request's slots whose `weekday` and `hour` fall in their Availability.
3. Sort by score, highest first; break ties by the fewest requests they have claimed with status `pending` or `rescheduled`.
4. Return no suggestions when `campus_id` or `course_code` is null or `times_unclear` is set, and say why.

Matching never assigns. Run it when the Scheduler opens an unclaimed request; store nothing.

### 14.7 Notifying the advisee

The Scheduler shows a **Notify on Teams** button on a claimed request. It opens `https://teams.microsoft.com/l/chat/0/0?users=<cardinal_mail>&message=<text>`, with the Peer Adviser's name, the Course, and the scheduled date (`scheduled_on`, plus `scheduled_start` when set) filled in. Build the link in the browser for the claiming Peer Adviser only; the Worker sends no message and stores nothing about it.

### 14.8 Teaching Kit files

- Accept PDF only, at most 5 MiB. Check `Content-Length`, enforce the limit again while streaming, and require the `%PDF-` signature in the first bytes.
- Before writing, sum `kit_files.size_bytes`. Reject the upload with a clear quota error when the total would pass 500 MB. This keeps the rest of the KV namespace for Profile images.
- Uploading creates the `kit_files` row first, then stores the bytes in KV under `kit/<file id>.pdf`. Never store a file under a user-supplied name.
- Serve a file only to a Peer Adviser or Administrator, with `Content-Type: application/pdf`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox`, and `Cache-Control: private`. Never cache it publicly.
- Only the current approved version and pending Kit Drafts hold items. After any batch that deletes items, delete each `kit_files` row and KV key that no `kit_items` row points at. Each upload also sweeps files that have sat unattached for more than 24 hours. `on delete restrict` stops a file in use from being deleted.
- Drive and YouTube items accept only `https://drive.google.com/`, `https://docs.google.com/`, `https://www.youtube.com/`, and `https://youtu.be/` URLs. Drive's own sharing settings decide who can open a Drive file.

### 14.9 Kit Draft approval

- Proposing a kit finds or creates its `teaching_kits` row for the Course, academic year, and term, with `current_version_id` null, then inserts the Kit Draft. Two Peer Advisers proposing the same new kit share one kit row.
- Creating or editing a kit creates a `kit_versions` row with status `pending`, a full copy of the title, body, and items, and `base_version_id` set to the approved version it was written against. Each Peer Adviser has at most one pending draft per kit, and may edit it until it is reviewed.
- Approving runs one D1 batch: set the version to `approved` (`where status = 'pending'` and the kit matches), set `teaching_kits.current_version_id` to it, delete the items of every older approved version of the kit (their title and body stay as history), and write the audit entry. The review screen flags a draft whose `base_version_id` is no longer the current version, because approving it replaces the newer content.
- Rejecting sets `rejected` with a required `review_note`, deletes the draft's items, and writes the audit entry with the note as its reason. The row stays so the author can read the note.
- Peer Advisers see only the `current_version_id` version of each kit; a kit with no approved version is hidden from everyone except its draft authors and Administrators. To restore an older version, a Peer Adviser proposes it again.

### 14.10 Routes

| Route | Who | Purpose |
| --- | --- | --- |
| `GET /portal` | Peer Adviser | Landing page: my claimed requests, kits for my courses |
| `GET /portal/kits`, `/portal/kits/[id]` | Peer Adviser | Search kits by Course and term; read the approved version |
| `GET /portal/kits/[id]/edit`, `/portal/kits/new` | Peer Adviser | Write a Kit Draft |
| `GET /portal/scheduler` | Peer Adviser | Advising Requests, filterable by status, Course, campus, and claimant |
| `GET /portal/directory` | Peer Adviser | Peer Advisers and Officers by position |
| `GET /portal/me` | Peer Adviser | Campus, courses taught, weekly Availability grid |
| `GET /admin/peer-advisers` | Administrator | Approve, revoke, set Campus and Officer position |
| `GET /admin/kit-drafts` | Administrator | Review pending Kit Drafts |
| `POST /api/portal/...` | Peer Adviser | Claim, give back, set status, schedule, slots, notes; Kit Draft writes; file upload; Course add; own Campus, courses, and Availability |
| `POST /api/admin/...` | Administrator | Approve, revoke, or update a Peer Adviser; assign a request; review a Kit Draft; edit, merge, or delete a Course; add a Campus |
| `POST /api/intake/advising-requests` | Apps Script | Intake (section 14.4) |

Every browser mutation above goes through `guardMutation`, then `requirePeerAdviser()` or the Administrator check. Portal pages send `Cache-Control: private, no-store` and `noindex`.
