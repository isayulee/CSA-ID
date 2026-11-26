/**
 * CSA intake Sheet → Portal (agent_technical_readme.md §14.4).
 *
 * Reads the intake Form's response Sheet and pushes rows to POST /api/intake/advising-requests.
 * It never writes to the Sheet. It sends only the columns in COLUMNS below, so the Student's
 * Signature answer never leaves the Sheet. Resending a row is safe: the Portal keys each row by
 * its Timestamp and Email Address and ignores one it already has.
 *
 * Script properties (Project Settings → Script properties):
 *   INTAKE_URL     https://<live host>/api/intake/advising-requests
 *   INTAKE_SECRET  the same value the owner set as the Worker secret INTAKE_SECRET
 *
 * Install steps: scripts/intake/README.md.
 */

// The response sheet's tab name.
var SHEET_NAME = 'Form Responses 1';

// Field the Portal expects → the start of that column's header in row 1, compared ignoring case.
// Run checkColumns() after any change and confirm every column it prints.
var COLUMNS = {
  timestamp: 'Timestamp',
  email: 'Email Address',
  fullName: 'Full Name',
  studentNumber: 'Student Number',
  programYear: 'Program',
  cardinalMail: 'Cardinal Mail',
  campus: 'Campus',
  course: 'Course',
  topic: 'Topic',
  attendees: 'Number of Attendees',
  availableDays: 'Available Day',
  availableTimes: 'Available Time',
  // The three columns the CSA team edits by hand.
  peerAdviser: 'Peer Adviser',
  scheduledDate: 'Scheduled Date',
  remarks: 'Remarks',
};
var OPTIONAL_COLUMNS = { peerAdviser: true, scheduledDate: true, remarks: true };

var ROWS_PER_REQUEST = 100;   // the endpoint's limit
var LAUNCH_ROWS_PER_DAY = 500; // keeps the launch import inside D1's free daily writes
var RESEND_WINDOW_MS = 24 * 60 * 60 * 1000;

function sheet_() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error('No sheet named "' + SHEET_NAME + '". Set SHEET_NAME in Code.gs.');
  return sheet;
}

/** Field → column index (0-based). Throws when a required column is missing. */
function columns_(headers) {
  var found = {};
  var missing = [];
  Object.keys(COLUMNS).forEach(function (field) {
    var wanted = COLUMNS[field].toLowerCase();
    var index = headers.findIndex(function (header) { return String(header).trim().toLowerCase().indexOf(wanted) === 0; });
    if (index === -1 && !OPTIONAL_COLUMNS[field]) missing.push(field + ' ("' + COLUMNS[field] + '")');
    if (index !== -1) found[field] = index;
  });
  if (missing.length) throw new Error('Columns not found: ' + missing.join(', ') + '. Fix COLUMNS in Code.gs.');
  return found;
}

/** One Sheet row as the endpoint expects it. Dates go as ISO text; nothing outside COLUMNS is sent. */
function toRow_(values, columns, timeZone) {
  var row = {};
  Object.keys(columns).forEach(function (field) {
    var value = values[columns[field]];
    if (value instanceof Date) {
      value = field === 'timestamp' ? value.toISOString() : Utilities.formatDate(value, timeZone, 'yyyy-MM-dd');
    }
    row[field] = value === null || value === undefined ? '' : value;
  });
  return row;
}

/** Sends rows in requests of 100. Throws on any error so the trigger's run shows as failed. */
function send_(rows) {
  var properties = PropertiesService.getScriptProperties();
  var url = properties.getProperty('INTAKE_URL');
  var secret = properties.getProperty('INTAKE_SECRET');
  if (!url || !secret) throw new Error('Set INTAKE_URL and INTAKE_SECRET in Script properties.');
  for (var i = 0; i < rows.length; i += ROWS_PER_REQUEST) {
    var response = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + secret },
      payload: JSON.stringify(rows.slice(i, i + ROWS_PER_REQUEST)),
      muteHttpExceptions: true,
    });
    var status = response.getResponseCode();
    var text = response.getContentText();
    if (status !== 200) throw new Error('Intake returned ' + status + ': ' + text);
    var result = JSON.parse(text);
    console.log('Intake: ' + text);
    if (result.failed && result.failed.length) throw new Error('Intake could not write ' + result.failed.length + ' rows; the next run resends them.');
  }
}

/** The data rows (row 2 onward), the field → column map, and the Sheet's time zone. */
function readRows_() {
  var sheet = sheet_();
  var values = sheet.getDataRange().getValues();
  return { headers: values[0], rows: values.slice(1), columns: columns_(values[0]), timeZone: sheet.getParent().getSpreadsheetTimeZone() };
}

/** Sends the given Sheet rows, if any. */
function sendRows_(data, rows) {
  if (rows.length) send_(rows.map(function (values) { return toRow_(values, data.columns, data.timeZone); }));
}

/** Run once by hand after install: prints which column each field reads. Sends nothing. */
function checkColumns() {
  var data = readRows_();
  var columns = data.columns;
  Object.keys(COLUMNS).forEach(function (field) {
    console.log(field + ' ← ' + (field in columns ? '"' + data.headers[columns[field]] + '"' : '(not found, optional)'));
  });
  console.log(data.rows.length + ' data rows.');
}

/** Installable "on form submit" trigger: sends the new response. */
function onFormSubmit(e) {
  if (!e || !e.range) return;
  var data = readRows_();
  sendRows_(data, [data.rows[e.range.getRow() - 2]].filter(Boolean));
}

/** Every 15 minutes: resends the last day's responses, covering any push that failed. */
function resendRecent() {
  var data = readRows_();
  var since = Date.now() - RESEND_WINDOW_MS;
  sendRows_(data, data.rows.filter(function (values) {
    var timestamp = values[data.columns.timestamp];
    return timestamp instanceof Date && timestamp.getTime() >= since;
  }));
}

/**
 * Launch import, run daily by its trigger: sends the next 500 existing rows, then remembers where it
 * stopped. When every row is sent it removes its own trigger.
 */
function importNextDay() {
  var properties = PropertiesService.getScriptProperties();
  var next = Number(properties.getProperty('LAUNCH_NEXT_INDEX') || '0');
  var data = readRows_();
  sendRows_(data, data.rows.slice(next, next + LAUNCH_ROWS_PER_DAY).filter(function (values) {
    return values[data.columns.timestamp] instanceof Date;
  }));
  next = Math.min(next + LAUNCH_ROWS_PER_DAY, data.rows.length);
  properties.setProperty('LAUNCH_NEXT_INDEX', String(next));
  console.log('Launch import: ' + next + ' of ' + data.rows.length + ' rows sent.');
  if (next >= data.rows.length) removeTriggers_('importNextDay');
}

function removeTriggers_(handler) {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === handler) ScriptApp.deleteTrigger(trigger);
  });
}

/** Run once by hand: installs the form-submit and 15-minute triggers. Safe to run again. */
function installTriggers() {
  removeTriggers_('onFormSubmit');
  removeTriggers_('resendRecent');
  ScriptApp.newTrigger('onFormSubmit').forSpreadsheet(SpreadsheetApp.getActiveSpreadsheet()).onFormSubmit().create();
  ScriptApp.newTrigger('resendRecent').timeBased().everyMinutes(15).create();
}

/** Run once by hand to start the launch import: sends today's 500 rows now, then 500 more each day. */
function startLaunchImport() {
  removeTriggers_('importNextDay');
  PropertiesService.getScriptProperties().setProperty('LAUNCH_NEXT_INDEX', '0');
  ScriptApp.newTrigger('importNextDay').timeBased().everyDays(1).create();
  importNextDay();
}
