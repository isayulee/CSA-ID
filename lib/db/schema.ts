import { sql, type SQL } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex, type AnySQLiteColumn } from "drizzle-orm/sqlite-core";

/**
 * The schema in agent_technical_readme.md §6 and §14.3. migrations/0000 is
 * generated from this file; its triggers and Campus seed rows are written by
 * hand at the end of that file, because drizzle-kit cannot express them.
 */

const unixNow = sql`(unixepoch())`;

// D1 rejects a GLOB pattern over 50 bytes, so a #RRGGBB check is three tests, not one glob.
const isHex = (column: AnySQLiteColumn) => sql`length(${column}) = 7 and ${column} glob '#*' and substr(${column}, 2) not glob '*[^0-9A-Fa-f]*'`;
const isHttpsUrl = (column: AnySQLiteColumn) => sql`${column} glob 'https://*' and length(${column}) <= 500`;
const isDate = (column: AnySQLiteColumn) => sql`${column} glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`;
const isService = (column: AnySQLiteColumn) => sql`${column} in ('linkedin', 'instagram', 'facebook', 'github', 'youtube', 'tiktok', 'x', 'website')`;
const nullOr = (column: AnySQLiteColumn, condition: SQL) => sql`${column} is null or (${condition})`;

// Root of every cascade: keep checks few and certain.
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  googleSub: text("google_sub").notNull().unique(),
  email: text("email").notNull(),
  name: text("name").notNull(), // Google's name (or the email prefix), refreshed at sign-in
  ageConfirmedAt: integer("age_confirmed_at"), // set when the account is created
  createdAt: integer("created_at").notNull().default(unixNow),
}, (table) => [
  index("users_email_idx").on(table.email),
  check("users_email_check", sql`length(${table.email}) <= 320`),
  check("users_name_check", sql`length(${table.name}) between 1 and 128`),
]);

export const sessions = sqliteTable("sessions", {
  tokenHash: text("token_hash").primaryKey(), // SHA-256 hex of the cookie token
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: integer("expires_at").notNull(),
  createdAt: integer("created_at").notNull().default(unixNow),
}, (table) => [
  index("sessions_user_id_idx").on(table.userId),
  index("sessions_expires_at_idx").on(table.expiresAt),
  check("sessions_token_hash_check", sql`length(${table.tokenHash}) = 64`),
]);

// Outlives every Profile so a Slug can never be reused. Nothing deletes from it.
export const reservedSlugs = sqliteTable("reserved_slugs", {
  slug: text("slug").primaryKey(),
  reservedAt: integer("reserved_at").notNull().default(unixNow),
}, (table) => [
  check("reserved_slugs_slug_check", sql`length(${table.slug}) between 3 and 64
    and ${table.slug} not glob '*[^a-z0-9-]*'
    and ${table.slug} not glob '-*' and ${table.slug} not glob '*-' and ${table.slug} not glob '*--*'`),
]);

export const profiles = sqliteTable("profiles", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().unique().references(() => users.id, { onDelete: "cascade" }),
  slug: text("slug").unique().references(() => reservedSlugs.slug), // no cascade
  status: text("status", { enum: ["draft", "published", "suspended"] }).notNull().default("draft"),
  displayName: text("display_name").notNull().default(""),
  roleTitle: text("role_title").notNull().default(""),
  bio: text("bio").notNull().default(""),
  accentColor: text("accent_color").notNull().default("#B5121B"),
  // The card style: all four set, or all null for the theme default.
  iconColor: text("icon_color"),
  cardColor: text("card_color"),
  cardOpacity: integer("card_opacity"),
  cardFrosted: integer("card_frosted", { mode: "boolean" }),
  avatarKey: text("avatar_key"),
  backgroundKey: text("background_key"),
  evaluationUrl: text("evaluation_url"), // null = the shared CSA form
  studentNumber: text("student_number"),
  showStudentNumber: integer("show_student_number", { mode: "boolean" }).notNull().default(false),
  termsVersion: text("terms_version"),
  termsAcceptedAt: integer("terms_accepted_at"),
  createdAt: integer("created_at").notNull().default(unixNow),
  updatedAt: integer("updated_at").notNull().default(unixNow),
}, (table) => [
  check("profiles_status_check", sql`${table.status} in ('draft', 'published', 'suspended')`),
  check("profiles_display_name_check", sql`length(${table.displayName}) <= 128`),
  check("profiles_role_title_check", sql`length(${table.roleTitle}) <= 128`),
  check("profiles_bio_check", sql`length(${table.bio}) <= 500`),
  check("profiles_accent_color_check", isHex(table.accentColor)),
  check("profiles_icon_color_check", nullOr(table.iconColor, isHex(table.iconColor))),
  check("profiles_card_color_check", nullOr(table.cardColor, isHex(table.cardColor))),
  check("profiles_card_opacity_check", nullOr(table.cardOpacity, sql`${table.cardOpacity} between 70 and 100`)),
  check("profiles_card_frosted_check", nullOr(table.cardFrosted, sql`${table.cardFrosted} in (0, 1)`)),
  check("profiles_evaluation_url_check", nullOr(table.evaluationUrl, isHttpsUrl(table.evaluationUrl))),
  check("profiles_student_number_check", nullOr(table.studentNumber, sql`length(${table.studentNumber}) between 1 and 32 and ${table.studentNumber} not glob '*[^0-9]*'`)),
  check("profiles_show_student_number_check", sql`${table.showStudentNumber} in (0, 1)`),
  check("profiles_terms_version_check", nullOr(table.termsVersion, sql`length(${table.termsVersion}) between 1 and 32`)),
  check("profiles_card_style_check", sql`(${table.iconColor} is null) = (${table.cardColor} is null)
    and (${table.cardColor} is null) = (${table.cardOpacity} is null)
    and (${table.cardOpacity} is null) = (${table.cardFrosted} is null)`),
  check("profiles_terms_check", sql`(${table.termsVersion} is null) = (${table.termsAcceptedAt} is null)`),
]);

export const draftSocialLinks = sqliteTable("draft_social_links", {
  id: text("id").primaryKey(),
  profileId: text("profile_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  service: text("service").notNull(),
  url: text("url").notNull(),
  displayOrder: integer("display_order").notNull(),
}, (table) => [
  uniqueIndex("draft_link_service_idx").on(table.profileId, table.service),
  uniqueIndex("draft_link_order_idx").on(table.profileId, table.displayOrder),
  check("draft_link_service_check", isService(table.service)),
  check("draft_link_url_check", isHttpsUrl(table.url)),
  check("draft_link_order_check", sql`${table.displayOrder} between 0 and 9`),
]);

// A separate snapshot keeps draft edits private. Only publish writes it,
// copying from the checked draft, so it has no checks of its own.
export const publishedProfiles = sqliteTable("published_profiles", {
  profileId: text("profile_id").primaryKey().references(() => profiles.id, { onDelete: "cascade" }),
  slug: text("slug").notNull().unique().references(() => reservedSlugs.slug), // no cascade
  displayName: text("display_name").notNull(),
  roleTitle: text("role_title").notNull(),
  bio: text("bio").notNull(),
  accentColor: text("accent_color").notNull(),
  iconColor: text("icon_color"),
  cardColor: text("card_color"),
  cardOpacity: integer("card_opacity"),
  cardFrosted: integer("card_frosted", { mode: "boolean" }),
  avatarKey: text("avatar_key"),
  backgroundKey: text("background_key"),
  evaluationUrl: text("evaluation_url").notNull(), // resolved: the CSA form when the draft has none
  studentNumber: text("student_number"), // only when the CSA form is used or the Peer Adviser shows it
  showStudentNumber: integer("show_student_number", { mode: "boolean" }).notNull().default(false),
  publishedAt: integer("published_at").notNull().default(unixNow),
});

export const publishedSocialLinks = sqliteTable("published_social_links", {
  id: text("id").primaryKey(),
  profileId: text("profile_id").notNull().references(() => publishedProfiles.profileId, { onDelete: "cascade" }),
  service: text("service").notNull(),
  url: text("url").notNull(),
  displayOrder: integer("display_order").notNull(),
}, (table) => [
  uniqueIndex("published_link_service_idx").on(table.profileId, table.service),
  uniqueIndex("published_link_order_idx").on(table.profileId, table.displayOrder),
  check("published_link_service_check", isService(table.service)),
  check("published_link_url_check", isHttpsUrl(table.url)),
  check("published_link_order_check", sql`${table.displayOrder} between 0 and 9`),
]);

// Anonymous: no reporter contact. Who closed a report, and when, is in the audit log.
export const abuseReports = sqliteTable("abuse_reports", {
  id: text("id").primaryKey(),
  profileId: text("profile_id").references(() => profiles.id, { onDelete: "set null" }),
  slug: text("slug").references(() => reservedSlugs.slug), // set on every new report
  reason: text("reason", { enum: ["impersonation", "malicious-link", "prohibited-content"] }).notNull(),
  details: text("details").notNull().default(""),
  status: text("status", { enum: ["open", "resolved", "dismissed"] }).notNull().default("open"),
  createdAt: integer("created_at").notNull().default(unixNow),
}, (table) => [
  index("abuse_reports_profile_idx").on(table.profileId, table.createdAt),
  index("abuse_reports_created_idx").on(table.createdAt),
  check("abuse_reports_reason_check", sql`${table.reason} in ('impersonation', 'malicious-link', 'prohibited-content')`),
  check("abuse_reports_details_check", sql`length(${table.details}) <= 1000`),
  check("abuse_reports_status_check", sql`${table.status} in ('open', 'resolved', 'dismissed')`),
]);

// Append-only (triggers in the migration reject UPDATE and DELETE). Actor and target
// are plain values, not foreign keys, so entries survive account and content deletion.
// target_label never holds a name or an email address.
export const adminAuditLog = sqliteTable("admin_audit_log", {
  id: text("id").primaryKey(),
  actorGoogleSub: text("actor_google_sub").notNull(),
  action: text("action", { enum: [
    "suspend", "unsuspend", "remove_images",
    "resolve_report", "dismiss_report",
    "approve_peer_adviser", "revoke_peer_adviser", "update_peer_adviser",
    "assign_advising_request",
    "approve_kit_draft", "reject_kit_draft",
    "update_course", "merge_course", "delete_course",
    "add_campus",
  ] }).notNull(),
  targetType: text("target_type", { enum: ["profile", "abuse_report", "user", "advising_request", "kit_version", "course", "campus"] }).notNull(),
  targetId: text("target_id").notNull(),
  targetLabel: text("target_label").notNull().default(""), // e.g. the Slug, 'MATH146-0 → MATH146', 'Makati'
  reason: text("reason"),
  createdAt: integer("created_at").notNull().default(unixNow),
}, (table) => [
  index("admin_audit_log_target_idx").on(table.targetType, table.targetId, table.createdAt),
  check("admin_audit_log_action_check", sql`${table.action} in (
    'suspend', 'unsuspend', 'remove_images',
    'resolve_report', 'dismiss_report',
    'approve_peer_adviser', 'revoke_peer_adviser', 'update_peer_adviser',
    'assign_advising_request',
    'approve_kit_draft', 'reject_kit_draft',
    'update_course', 'merge_course', 'delete_course',
    'add_campus'
  )`),
  check("admin_audit_log_target_type_check", sql`${table.targetType} in ('profile', 'abuse_report', 'user', 'advising_request', 'kit_version', 'course', 'campus')`),
  check("admin_audit_log_target_id_check", sql`length(${table.targetId}) between 1 and 64`),
  check("admin_audit_log_target_label_check", sql`length(${table.targetLabel}) <= 128`),
  check("admin_audit_log_reason_check", nullOr(table.reason, sql`length(${table.reason}) between 1 and 1000`)),
  check("admin_audit_log_target_matches_action_check", sql`${table.targetType} = case
    when ${table.action} in ('suspend', 'unsuspend', 'remove_images') then 'profile'
    when ${table.action} in ('resolve_report', 'dismiss_report') then 'abuse_report'
    when ${table.action} in ('approve_peer_adviser', 'revoke_peer_adviser', 'update_peer_adviser') then 'user'
    when ${table.action} = 'assign_advising_request' then 'advising_request'
    when ${table.action} in ('approve_kit_draft', 'reject_kit_draft') then 'kit_version'
    when ${table.action} in ('update_course', 'merge_course', 'delete_course') then 'course'
    when ${table.action} = 'add_campus' then 'campus'
  end`),
]);

// Portal (§14.3). A list that may grow lives in a table, never in a check,
// because changing a check later rebuilds every table that carries it.
// The migration seeds ('intramuros', 'Intramuros') and ('makati', 'Makati').
export const campuses = sqliteTable("campuses", {
  id: text("id").primaryKey(), // e.g. intramuros
  name: text("name").notNull().unique(), // e.g. Intramuros
  createdAt: integer("created_at").notNull().default(unixNow),
}, (table) => [
  check("campuses_id_check", sql`length(${table.id}) between 2 and 32 and ${table.id} not glob '*[^a-z0-9-]*'`),
  check("campuses_name_check", sql`length(${table.name}) between 1 and 64`),
]);

export const courses = sqliteTable("courses", {
  code: text("code").primaryKey(), // e.g. MATH146, CHM11-3L
  title: text("title").notNull(),
  createdByUserId: text("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: integer("created_at").notNull().default(unixNow),
}, (table) => [
  check("courses_code_check", sql`length(${table.code}) between 2 and 16
    and ${table.code} glob '[A-Z]*'
    and ${table.code} not glob '*[^A-Z0-9-]*'
    and ${table.code} not glob '*-'`),
  check("courses_title_check", sql`length(${table.title}) between 1 and 128`),
]);

// A row means approved. Revoking deletes it.
export const peerAdvisers = sqliteTable("peer_advisers", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  campusId: text("campus_id").notNull().references(() => campuses.id, { onDelete: "restrict" }),
  officerPosition: text("officer_position"),
  officerOrder: integer("officer_order"), // order in the Directory
  approvedAt: integer("approved_at").notNull().default(unixNow),
}, (table) => [
  index("peer_advisers_campus_idx").on(table.campusId),
  check("peer_advisers_officer_position_check", nullOr(table.officerPosition, sql`length(${table.officerPosition}) between 1 and 64`)),
  check("peer_advisers_officer_order_check", nullOr(table.officerOrder, sql`${table.officerOrder} between 1 and 99`)),
  check("peer_advisers_officer_check", sql`(${table.officerPosition} is null) = (${table.officerOrder} is null)`),
]);

export const peerAdviserCourses = sqliteTable("peer_adviser_courses", {
  userId: text("user_id").notNull().references(() => peerAdvisers.userId, { onDelete: "cascade" }),
  courseCode: text("course_code").notNull().references(() => courses.code, { onUpdate: "cascade", onDelete: "restrict" }),
}, (table) => [
  primaryKey({ columns: [table.userId, table.courseCode] }),
  index("peer_adviser_courses_course_idx").on(table.courseCode), // who tutors a Course
]);

// One row per free hour; weekday 1 = Monday ... 6 = Saturday; hour 8 = 08:00-09:00 ... 16 = 16:00-17:00.
export const peerAdviserAvailability = sqliteTable("peer_adviser_availability", {
  userId: text("user_id").notNull().references(() => peerAdvisers.userId, { onDelete: "cascade" }),
  weekday: integer("weekday").notNull(),
  hour: integer("hour").notNull(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.weekday, table.hour] }),
  check("peer_adviser_availability_weekday_check", sql`${table.weekday} between 1 and 6`),
  check("peer_adviser_availability_hour_check", sql`${table.hour} between 8 and 16`),
]);

export const teachingKits = sqliteTable("teaching_kits", {
  id: text("id").primaryKey(),
  courseCode: text("course_code").notNull().references(() => courses.code, { onUpdate: "cascade", onDelete: "restrict" }),
  academicYear: integer("academic_year").notNull(), // starting year: 2026 = AY 2026-2027
  term: integer("term").notNull(),
  // Null until the first approval; set only by the approve batch.
  currentVersionId: text("current_version_id").references((): AnySQLiteColumn => kitVersions.id, { onDelete: "restrict" }),
  createdAt: integer("created_at").notNull().default(unixNow),
}, (table) => [
  uniqueIndex("teaching_kits_course_term_idx").on(table.courseCode, table.academicYear, table.term),
  check("teaching_kits_academic_year_check", sql`${table.academicYear} between 2000 and 2100`),
  check("teaching_kits_term_check", sql`${table.term} between 1 and 4`),
]);

// A Kit Draft is a row with status 'pending'. Approved and rejected rows are never edited again.
export const kitVersions = sqliteTable("kit_versions", {
  id: text("id").primaryKey(),
  kitId: text("kit_id").notNull().references(() => teachingKits.id, { onDelete: "cascade" }),
  // The approved version it was written against; null for a new kit.
  baseVersionId: text("base_version_id").references((): AnySQLiteColumn => kitVersions.id, { onDelete: "set null" }),
  status: text("status", { enum: ["pending", "approved", "rejected"] }).notNull().default("pending"),
  title: text("title").notNull(),
  body: text("body").notNull().default(""), // Markdown, rendered without raw HTML
  authorUserId: text("author_user_id").references(() => users.id, { onDelete: "set null" }),
  reviewNote: text("review_note"),
  createdAt: integer("created_at").notNull().default(unixNow),
  updatedAt: integer("updated_at").notNull().default(unixNow),
  reviewedAt: integer("reviewed_at"),
}, (table) => [
  uniqueIndex("kit_versions_one_pending_per_author").on(table.kitId, table.authorUserId).where(sql`${table.status} = 'pending'`),
  index("kit_versions_kit_idx").on(table.kitId, table.status),
  index("kit_versions_pending_idx").on(table.createdAt).where(sql`${table.status} = 'pending'`), // the review queue
  check("kit_versions_status_check", sql`${table.status} in ('pending', 'approved', 'rejected')`),
  check("kit_versions_title_check", sql`length(${table.title}) between 1 and 128`),
  check("kit_versions_body_check", sql`length(${table.body}) <= 20000`),
  check("kit_versions_review_note_check", nullOr(table.reviewNote, sql`length(${table.reviewNote}) between 1 and 1000`)),
  check("kit_versions_reviewed_check", sql`(${table.status} = 'pending') = (${table.reviewedAt} is null)`),
  check("kit_versions_rejected_note_check", sql`${table.status} != 'rejected' or ${table.reviewNote} is not null`),
]);

// One row per stored PDF; several versions may point at the same file.
export const kitFiles = sqliteTable("kit_files", {
  id: text("id").primaryKey(),
  kvKey: text("kv_key").notNull().unique(), // kit/<file id>.pdf, never a user-supplied name
  sizeBytes: integer("size_bytes").notNull(),
  uploadedByUserId: text("uploaded_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: integer("created_at").notNull().default(unixNow),
}, (table) => [
  check("kit_files_size_bytes_check", sql`${table.sizeBytes} between 1 and 5242880`),
]);

export const kitItems = sqliteTable("kit_items", {
  id: text("id").primaryKey(),
  versionId: text("version_id").notNull().references(() => kitVersions.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["pdf", "drive", "youtube"] }).notNull(),
  label: text("label").notNull(),
  url: text("url"), // drive and youtube
  fileId: text("file_id").references(() => kitFiles.id, { onDelete: "restrict" }), // pdf
  displayOrder: integer("display_order").notNull(),
}, (table) => [
  uniqueIndex("kit_items_order_idx").on(table.versionId, table.displayOrder),
  index("kit_items_file_idx").on(table.fileId),
  check("kit_items_kind_check", sql`${table.kind} in ('pdf', 'drive', 'youtube')`),
  check("kit_items_label_check", sql`length(${table.label}) between 1 and 128`),
  check("kit_items_url_check", nullOr(table.url, isHttpsUrl(table.url))),
  check("kit_items_display_order_check", sql`${table.displayOrder} between 0 and 49`),
  check("kit_items_file_check", sql`(${table.kind} = 'pdf') = (${table.fileId} is not null)`),
  check("kit_items_url_kind_check", sql`(${table.kind} = 'pdf') = (${table.url} is null)`),
]);

export const advisingRequests = sqliteTable("advising_requests", {
  id: text("id").primaryKey(),
  // SHA-256 hex of the form's Timestamp and Email Address; makes intake idempotent.
  intakeKey: text("intake_key").notNull().unique(),
  submittedAt: integer("submitted_at").notNull(), // the form's Timestamp
  campusText: text("campus_text").notNull(), // as answered
  campusId: text("campus_id").references(() => campuses.id, { onDelete: "restrict" }), // matched; null until a person fixes it
  courseText: text("course_text").notNull(), // as typed, e.g. "Calculus 1/MATH146"
  courseCode: text("course_code").references(() => courses.code, { onUpdate: "cascade", onDelete: "restrict" }), // parsed; null until a person picks it
  topic: text("topic").notNull().default(""),
  attendeeCount: integer("attendee_count").notNull().default(1),
  availableDayText: text("available_day_text").notNull().default(""),
  availableTimeText: text("available_time_text").notNull().default(""),
  timesUnclear: integer("times_unclear", { mode: "boolean" }).notNull().default(false),
  status: text("status", { enum: ["pending", "rescheduled", "done", "cancelled", "no_peer_adviser_available", "no_response_from_advisee"] }).notNull().default("pending"),
  claimedByUserId: text("claimed_by_user_id").references(() => users.id, { onDelete: "set null" }),
  // Meaningful only while claimed; no paired check, or deleting the claimant's account would fail.
  claimedAt: integer("claimed_at"),
  scheduledOn: text("scheduled_on"),
  scheduledStart: text("scheduled_start"),
  sheetPeerAdviser: text("sheet_peer_adviser"), // imported rows only: the Sheet's Peer Adviser text
  sheetRemarks: text("sheet_remarks"), // imported rows only: the full Remarks text
  createdAt: integer("created_at").notNull().default(unixNow),
  updatedAt: integer("updated_at").notNull().default(unixNow),
}, (table) => [
  index("advising_requests_status_idx").on(table.status, table.submittedAt),
  index("advising_requests_claimed_idx").on(table.claimedByUserId, table.status),
  check("advising_requests_intake_key_check", sql`length(${table.intakeKey}) = 64`),
  check("advising_requests_campus_text_check", sql`length(${table.campusText}) <= 100`),
  check("advising_requests_course_text_check", sql`length(${table.courseText}) <= 200`),
  check("advising_requests_topic_check", sql`length(${table.topic}) <= 2000`),
  check("advising_requests_attendee_count_check", sql`${table.attendeeCount} between 1 and 50`),
  check("advising_requests_available_day_text_check", sql`length(${table.availableDayText}) <= 500`),
  check("advising_requests_available_time_text_check", sql`length(${table.availableTimeText}) <= 500`),
  check("advising_requests_times_unclear_check", sql`${table.timesUnclear} in (0, 1)`),
  check("advising_requests_status_check", sql`${table.status} in (
    'pending', 'rescheduled', 'done', 'cancelled',
    'no_peer_adviser_available', 'no_response_from_advisee'
  )`),
  check("advising_requests_scheduled_on_check", nullOr(table.scheduledOn, isDate(table.scheduledOn))),
  check("advising_requests_scheduled_start_check", nullOr(table.scheduledStart, sql`${table.scheduledStart} glob '[0-2][0-9]:[0-5][0-9]'`)),
  check("advising_requests_sheet_peer_adviser_check", nullOr(table.sheetPeerAdviser, sql`length(${table.sheetPeerAdviser}) <= 200`)),
  check("advising_requests_sheet_remarks_check", nullOr(table.sheetRemarks, sql`length(${table.sheetRemarks}) <= 2000`)),
  check("advising_requests_schedule_check", sql`${table.scheduledStart} is null or ${table.scheduledOn} is not null`),
]);

// Personal data lives apart so a retention job can delete these rows and keep the request counts.
export const adviseeContacts = sqliteTable("advisee_contacts", {
  requestId: text("request_id").primaryKey().references(() => advisingRequests.id, { onDelete: "cascade" }),
  fullName: text("full_name").notNull(),
  studentNumber: text("student_number").notNull(),
  programYear: text("program_year").notNull().default(""),
  email: text("email").notNull(),
  cardinalMail: text("cardinal_mail").notNull(),
}, (table) => [
  check("advisee_contacts_full_name_check", sql`length(${table.fullName}) between 1 and 200`),
  check("advisee_contacts_student_number_check", sql`length(${table.studentNumber}) <= 32`),
  check("advisee_contacts_program_year_check", sql`length(${table.programYear}) <= 64`),
  check("advisee_contacts_email_check", sql`length(${table.email}) <= 320`),
  check("advisee_contacts_cardinal_mail_check", sql`length(${table.cardinalMail}) <= 320`),
]);

// Parsed or hand-set free time. weekday is always set: a dated slot stores its date's weekday.
// on_date '' means every week. The primary key stops duplicate slots.
export const advisingRequestSlots = sqliteTable("advising_request_slots", {
  requestId: text("request_id").notNull().references(() => advisingRequests.id, { onDelete: "cascade" }),
  weekday: integer("weekday").notNull(),
  onDate: text("on_date").notNull().default(""),
  hour: integer("hour").notNull(),
}, (table) => [
  primaryKey({ columns: [table.requestId, table.weekday, table.onDate, table.hour] }),
  check("advising_request_slots_weekday_check", sql`${table.weekday} between 1 and 6`),
  check("advising_request_slots_on_date_check", sql`${table.onDate} = '' or ${isDate(table.onDate)}`),
  check("advising_request_slots_hour_check", sql`${table.hour} between 8 and 16`),
]);

// Append-only, enforced in code. No triggers, so a retention job can still delete notes.
export const advisingNotes = sqliteTable("advising_notes", {
  id: text("id").primaryKey(),
  requestId: text("request_id").notNull().references(() => advisingRequests.id, { onDelete: "cascade" }),
  authorUserId: text("author_user_id").references(() => users.id, { onDelete: "set null" }),
  body: text("body").notNull(),
  createdAt: integer("created_at").notNull().default(unixNow),
}, (table) => [
  index("advising_notes_request_idx").on(table.requestId, table.createdAt),
  check("advising_notes_body_check", sql`length(${table.body}) between 1 and 2000`),
]);

export type AdminAuditAction = typeof adminAuditLog.$inferInsert["action"];
export type AdminAuditTarget = typeof adminAuditLog.$inferInsert["targetType"];
export type User = typeof users.$inferSelect;
export type Profile = typeof profiles.$inferSelect;
