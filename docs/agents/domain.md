# Domain Docs

How the engineering skills should consume this repo's domain documentation.

## Before exploring, read these

- **`GLOSSARY.md`**: the canonical domain language: User, Profile, Slug, Draft / Published / Suspended Profile, Social Link, Administrator, Abuse Report, NFC Card. It plays the role other repos give `CONTEXT.md`; there is no `CONTEXT.md` here.
- **`PRODUCT.md`**: users, purpose, constraints, and open decisions.
- **`agent_technical_readme.md`**: the implementation contract: architecture, data model, authorization, validation, uploads, routes, and the completion checklist. Read the sections that touch the area you are about to work in.
- **`docs/adr/`** (may not exist): decision records.

If an optional file doesn't exist, proceed silently. Don't suggest creating it upfront.

## Where new terms and decisions go

`GLOSSARY.md`, `PRODUCT.md` and `agent_technical_readme.md` belong to the maintainer (see [AGENTS.md](../../AGENTS.md#files-you-leave-as-they-are)). When a term or decision you need is missing, raise it in the issue instead of editing those files or coining a new word. Do not create a `CONTEXT.md` that duplicates `GLOSSARY.md`.

## Use the glossary's vocabulary

When your output names a domain concept (an issue title, a proposal, a hypothesis, a test name), use the term as defined in `GLOSSARY.md`. Don't drift to the synonyms it lists under _Avoid_ (for example "card profile", "handle", "banned account").

If the concept you need isn't in the glossary, either you're inventing language the project doesn't use (reconsider) or there's a real gap (raise it in the issue).

## Flag contract conflicts

If your output contradicts `agent_technical_readme.md` or an ADR, say so explicitly rather than silently overriding:

> _Contradicts the technical README §8 (image upload pipeline), but worth reopening because…_
