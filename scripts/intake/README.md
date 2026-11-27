# Intake Sheet → Portal

[`Code.gs`](Code.gs) is an Apps Script bound to the CSA intake Form's response Sheet. It sends each response to `POST /api/intake/advising-requests`, which saves it as an Advising Request (`agent_technical_readme.md` §14.4). The script only reads the Sheet and never writes to it. It sends only the columns listed in `COLUMNS`, so the Student's Signature answer never leaves the Sheet.

Resending is always safe. The Portal keys each row by its Timestamp and Email Address and ignores any row it already has. Later edits to an imported row in the Sheet (Peer Adviser, Scheduled Date, Remarks) do not change the Portal.

## Who does what

- **Owner:** creates the secret and sets it as the Worker secret `INTAKE_SECRET`. Agents never run `wrangler secret put`.
- **CSA team:** installs the script on the Sheet and pastes the same secret into its Script properties.

## Install

1. **Make the secret (owner).** Generate a long random value, for example `openssl rand -hex 32`, and set it on the Worker: `npx wrangler secret put INTAKE_SECRET`. Keep it out of chat, email and the repository.
2. **Add the script (CSA team).** Open the response Sheet → **Extensions → Apps Script**. Replace the contents of `Code.gs` with this folder's `Code.gs` and save.
3. **Set Script properties.** In **Project Settings → Script properties**, add:
   - `INTAKE_URL`: `https://<live host>/api/intake/advising-requests`. Use the live site, never a preview.
   - `INTAKE_SECRET`: the owner's secret from step 1.
4. **Check the columns.** If the response tab isn't named `Form Responses 1`, change `SHEET_NAME`. Then select `checkColumns` and click **Run**, and approve the permissions it asks for. The log prints the header each field reads. When a field is not found or reads the wrong column, change its text in `COLUMNS`. Each entry matches the start of a header in row 1, ignoring case. `checkColumns` sends nothing.
5. **Turn on new responses.** Run `installTriggers` once. It adds:
   - an "on form submit" trigger that sends each new response, and
   - a trigger every 15 minutes that resends the last day's responses, in case a push failed.
6. **Import the existing rows (once, at launch).** Run `startLaunchImport`. It sends the first 500 rows now and 500 more each day, so the import stays inside D1's free daily write limit. Once every row is sent, it removes its own daily trigger. **Executions** shows its progress (`Launch import: N of M rows sent`).

For imported rows, the Portal reads the Remarks column into one of the six statuses (pending, rescheduled, done, cancelled, no Peer Adviser available, no response from advisee) by the first status phrase in it, and keeps the full text. It keeps the Peer Adviser column as text and never guesses who claimed a request from a name. A Scheduled Date such as `27-Aug-25` becomes the scheduled date; any other format is left empty.

## Checking a run

- **Executions** in the Apps Script editor lists every trigger run. Each push logs the Portal's reply: `received`, `imported`, `duplicates`, `rejected` (a row without a readable Timestamp or with an empty Email Address or Full Name) and `failed`.
- A run fails when the Portal returns an error or cannot write some rows. The next 15-minute run resends them.
- A `401` means `INTAKE_SECRET` in Script properties differs from the Worker secret.

## Testing

Test with fake data on your own machine, never against the live Sheet from a preview. Previews share the live database. With `npm run dev` running and `INTAKE_SECRET` in `.dev.vars`:

```bash
curl -s http://localhost:3000/api/intake/advising-requests \
  -H "Authorization: Bearer $INTAKE_SECRET" -H "Content-Type: application/json" \
  -d '[{"timestamp":"2026-08-24T01:15:00.000Z","email":"advisee@example.test","fullName":"Test Advisee","studentNumber":"2024000000","programYear":"BS CS 2","cardinalMail":"test@example.test","campus":"Intramuros","course":"Calculus 1/MATH146","topic":"Limits","attendees":"1","availableDays":"MWF","availableTimes":"1-3pm"}]'
```
