# Move the live app to the shared Cloudflare account

A one-off. Delete this folder once the move is done; Part 3 reminds you. The plan and its reasons are in [build: move the live app to the shared Cloudflare account](https://github.com/isayulee/CSA-ID/issues/95), which follows from [the cutover decision](https://github.com/isayulee/CSA-ID/issues/92).

## Why

The repository moved to `isayulee/CSA-ID`, but the live app still runs on ymsrubio's personal Cloudflare account, at `csa-id.yuanmiguelrubio.workers.dev`. Workers Builds there stopped building after the transfer. A Worker can only use a D1 database in its own account, so the whole app moves to the shared team account: the Worker, the D1 database, the Profile images in KV, Turnstile and the secrets. The old address becomes a redirect, so NFC Cards keep working until they're rewritten.

## Who runs what, and when

| Step | Who | When | What it does |
| --- | --- | --- | --- |
| `move.sh prepare` | Anyone signed in to the shared account; stage 6 needs ymsrubio | Days before | Settles the `workers.dev` subdomain, creates the D1 database, KV namespace and Turnstile widget, and adds the new sign-in address to Google. Prints the five public values the pull request needs. |
| The pull request | An agent or anyone | After `prepare` | Points `wrangler.jsonc` at the shared account. It merges into `dev`, then a release carries it to `main`. |
| By hand | ymsrubio | Before the evening | Disconnects Workers Builds from the old `csa-id` Worker, and tells the Peer Advisers when the move is. |
| `move.sh evening` | ymsrubio | The announced quiet hour | Exports from the old account (read only), imports into the shared account, checks the new address, switches, and decides keep or undo within 30 minutes. |
| `move.sh cleanup` | ymsrubio, on the machine that ran the evening | 7 days after a keep | Deletes the old database and image namespace. |

```bash
bash scripts/move-to-shared-account/move.sh prepare
bash scripts/move-to-shared-account/move.sh evening       # or "evening 5" to resume at stage 5
bash scripts/move-to-shared-account/move.sh cleanup
```

## Signing in to both accounts

`evening` and `cleanup` reach two accounts, and they may need two different Cloudflare logins. Each command names its account in a config (`account_id`) and its login through a wrangler auth profile: `CLOUDFLARE_AUTH_PROFILE`, which `npm run deploy` and the OpenNext deploy pass on to wrangler, as a `--profile` flag could not. Before anything is exported or changed, stage 1 (and `cleanup`) asks each login, read only, whether it reaches its own account, and stops with the exact command when it doesn't.

Sign in once per account, with the browser (OAuth). The tokens stay in wrangler's own storage; the scripts never see them:

```bash
npx wrangler auth create csa-old      # sign in as the login that owns ymsrubio's personal account
npx wrangler auth create csa-shared   # sign in as the login that belongs to the shared isayulee account
```

A login that already sees both accounts is enough: the scripts fall back to the plain `wrangler login` when a named profile is missing, so `npx wrangler login` once works too. The named profiles leave that default login alone. Run `npx wrangler auth list` to see what exists (`auth` profiles are marked experimental in wrangler 4.159).

The scripts also unset `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_API_KEY`, `CLOUDFLARE_EMAIL` and `CLOUDFLARE_AUTH_PROFILE` from your shell first, since an API token would override every login. `prepare` is unchanged: it uses the plain login and the account you give it.

It needs Git, bash (Git Bash on Windows), curl, and Node 22.13 or later (`.nvmrc` has 24; the export uses Node's built-in SQLite) with `npm install` done. On Windows, keep the checkout path short (see [What the rehearsal found](#what-the-rehearsal-found)). Agents never run these: every part uses `--remote`.

## The evening

1. **Before you start:** checks for a clean, up-to-date `main` whose `wrangler.jsonc` points at the shared account, asks for the old account's ID, proves that each account's login reaches it (see [Signing in to both accounts](#signing-in-to-both-accounts)), and confirms that Workers Builds is disconnected, Google has the new address and the Peer Advisers were told.
2. **Count** every table in the old database (read only), and record its migrations.
3. **Export the database:** the structure, then every row except Sessions, as one import file with parent tables before their children. The file is replayed in an in-memory database with foreign keys enforced before the stage passes.
4. **Export the images:** every `img/` key, with its content type.
5. **Import the database** into the shared account in one all-or-nothing run, confirm it holds the exported rows byte for byte, then apply `main`'s migrations it doesn't have yet.
6. **Import the images**, then confirm the same keys, content types and bytes.
7. **Deploy `main`** to the shared account, then set the four secrets from hidden prompts.
8. **Check the new address:** the row counts match, the NFC Card's `/id/<slug>` opens, and Google sign-in lands on your own Profile. Nobody has been sent there yet.
9. **Switch:** first records the app's version id, then turns the old account's `csa-id` Worker into a 302 redirect to the same path on the new address. Running it again never deploys the redirect twice.
10. **Late writes:** compare the old database with the export, so any edit made after the export is caught.
11. **Connect Workers Builds** in the shared account, so merges to `main` deploy again.
12. **Keep or undo** within 30 minutes. Undo rolls the old Worker back to the version recorded in stage 9, on its untouched database. Either way, the exports (which hold personal data) are deleted.

## The release that carries this to `main`

#98 and #99 undid #80's rollback, so `main` already holds release #48's work, with migrations `0000` to `0004`, and `main` and `dev` agree apart from this pull request. What's still needed is this pull request, which points `wrangler.jsonc` and the README at the shared account:

1. Merge this pull request into `dev`.
2. Release `dev` into `main` with a merge commit. Only the owner opens and merges it. Merging deploys nothing yet: Workers Builds is disconnected from the old account's Worker (a step before the evening), and the shared account's isn't connected until stage 11. Don't deploy or migrate by hand before the evening: from the merge on, both go to the shared account, where the app would be live on an empty database.

The evening deploys whatever `main` holds. The old database is at migration `0004`, like `main`, so stage 5 normally has no migration left to apply after the import. It applies any that `main` holds and the old database lacks. Stage 8 checks the new site before anyone is sent to it.

## If something goes wrong

- **Before stage 9, nothing live has changed.** Stop, fix the problem, and resume with `move.sh evening <stage>`. After an import file was built by older code, resume at stage 2, not 5, so it's built again. Stage 5 offers to empty the shared database and import again.
- **After stage 9**, stage 12 undoes the switch within 30 minutes.
- **Late writes** (stage 10): `out/changes-old.diff` holds the exact rows, with `<` as exported and `>` as now.

## Rehearse it

```bash
bash scripts/move-to-shared-account/rehearse.sh
```

It runs the evening's data steps on two local databases and KV namespaces: stages 2 to 6, 8 and 10, plus starting over. It does so with the old database at migration `0002` and again at `0004`, like live, and calls the same `lib.sh` functions as `move.sh`. It also imports with the defer pragmas stripped, where the order as exported must fail and `import.sql` must pass, and makes each step fail through a fake Wrangler. It never passes `--remote`.

The deploy, secrets, redirect, rollback and Workers Builds stages only exist remotely, so read those stages in `move.sh`. The redirect Worker has its own test, `redirect-worker/test.mjs`.

## What the rehearsal found

- **Filtering the structure export loses indexes and triggers.** `wrangler d1 export --no-data --table …` drops every index and trigger, including the one that keeps a Slug from changing. So the structure export is unfiltered; only the data export is filtered, to leave Sessions behind.
- **Table order matters on import.** On 2026-11-25 the remote import stopped with `FOREIGN KEY constraint failed` on a file that put `draft_social_links` before `profiles`, despite its `PRAGMA defer_foreign_keys=TRUE`. The likely cause, not reproduced, is that the remote import doesn't defer across the whole file. Local D1 does, so the rehearsal missed it. `import-file.mjs` now orders the tables from their foreign keys. `data.sql` stays as exported, because later stages compare it with a fresh export.
- **`set -e` doesn't reach inside a condition.** `must` runs each step in `if !`, so a step that relied on `set -e` could fail halfway and still pass. Every step in `lib.sh` returns its own failures.
- **Queries use `--command`, not `--file`.** A remote `wrangler d1 execute --file` runs through D1's import and returns no rows.
- **Images copy exactly.** `wrangler kv key get` writes the raw bytes, and `wrangler kv bulk put` takes base64 values with their metadata.
- **Long paths break wrangler on Windows.** Past 260 characters in a local state path, it fails with a bare "internal error".

## Files

- `move.sh`: the wizard. Its library, above the `STAGES` marker, is the `/wizard` skill's template, unedited.
- `lib.sh`: the data steps, shared with the rehearsal.
- `import-file.mjs`: builds and replays the import file, parents first.
- `kv-files.mjs`: copies the image keys with their metadata.
- `redirect-worker/`: the old account's `csa-id` Worker after the switch, and its test.
- `rehearse.sh` and `rehearsal/`: the local rehearsal, its fake data and the import file's test.
- `out/`, `.move.env` and `.rehearsal/`: local state, ignored by Git. On the evening `out/` holds personal data; stage 12 deletes it.
