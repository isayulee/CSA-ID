# Issue tracker: GitHub Issues on `ymsrubio/CSA-ID`

Tickets are GitHub issues on `ymsrubio/CSA-ID`, so the whole team sees and divides the same work. Use the `gh` CLI. [AGENTS.md](../../AGENTS.md#issues) and [CONTRIBUTING.md](../../CONTRIBUTING.md#pick-up-a-ticket) hold the ticket rules; this file is the quick reference for skills.

## Issue format

Title: Conventional Commits style, plus the open blockers as a suffix, e.g. `feat: claim a permanent Slug (blocked by #5)`. Drop the suffix when every blocker is closed.

```markdown
Blocked by: #5

## What

<what to build or fix, in GLOSSARY.md terms>

## Done when

- <checkable outcome>

## Notes

<optional context>
```

Record blockers three ways: the `Blocked by:` line, the title suffix, and GitHub's native dependency (`gh api -X POST repos/ymsrubio/CSA-ID/issues/<n>/dependencies/blocked_by -F issue_id=<blocker's REST id>`).

## Conventions

- **Create**: `gh issue create --repo ymsrubio/CSA-ID --title ... --body ... --label needs-triage`.
- **Read**: `gh issue view <n> --repo ymsrubio/CSA-ID --comments`.
- **List**: `gh issue list --repo ymsrubio/CSA-ID`; filter with `--label ready-for-agent`.
- **Comment**: `gh issue comment <n> --body ...`. Progress notes go here, dated.
- **Apply / remove a triage role**: `gh issue edit <n> --add-label ... --remove-label ...`.
- **Claim**: add `in-progress` and assign the person (`--add-assignee @me`) before starting, so teammates don't collide.
- **Close**: link the PR with `Closes #<n>` in its body, or `gh issue close <n> --comment "<how it was resolved>"`.

## Pull requests as a triage surface

**PRs as a request surface: no.**

## When a skill says "publish to the issue tracker"

Create a GitHub issue as above. A PRD becomes an issue labelled `documentation` whose children reference it.

## Wayfinding operations

- **Frontier**: open issues with no open blocker and no assignee, lowest number first.
- **Claim**: add `in-progress` and an assignee.
- **Resolve**: comment with the answer and close.
