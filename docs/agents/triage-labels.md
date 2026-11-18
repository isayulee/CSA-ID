# Triage Labels

The skills speak in terms of five canonical triage roles. Each role is a GitHub label on `ymsrubio/CSA-ID` (see `issue-tracker.md`).

| Label in mattpocock/skills | GitHub label      | Meaning                                  |
| -------------------------- | ----------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`    | The owner needs to evaluate this ticket  |
| `needs-info`               | `needs-info`      | Waiting on more information              |
| `ready-for-agent`          | `ready-for-agent` | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human` | Requires human implementation            |
| `wontfix`                  | `wontfix`         | Will not be actioned                     |

One extra label: `in-progress` (claimed). Done means the issue is closed.

When a skill says to apply a role, add that label with `gh issue edit <n> --add-label <label>`.
