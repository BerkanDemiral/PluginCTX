---
description: Save a compact working-state snapshot so a fresh chat can continue exactly where this one stopped. Also used automatically by ctx-relay at ~50% context.
disable-model-invocation: true
---

Create a handoff snapshot for the next chat. Follow these rules exactly.

**1. Reach a safe state (without touching the user's work)**
- Finish only the smallest coherent unit already in progress; start nothing new.
- Never discard, revert, stash, reset, checkout or commit anything. Do not run git commands that change state.
- Run the project's build or type-check once to learn its status. Use `buildCommand` from `.claude/ctx-relay/config.json` if that file exists; otherwise use an obvious existing one (a `build`/`typecheck` script in package.json, `tsc --noEmit`, `cargo check`, `go build ./...`, `dotnet build`). Do not install dependencies. If there is no obvious command, write "build status: unknown".
- If it fails because of your own half-finished edit, fix that edit. If it fails for any other reason, do not fix it now; record it under Open issues.

**2. Write exactly one file: `.claude/ctx-relay/SNAPSHOT.md`** (create the folder if missing; overwrite the old file)
Use this structure, in the language the user has been using:

```
# Snapshot: <ISO date from your context>
## Goal
One or two sentences: what the user is trying to achieve.
## State
Build/test status with the command used; current branch; whether there are uncommitted changes.
## Done
Bullets: what is finished, with file paths.
## Next steps
Numbered, concrete, in order. The first item must be startable without further questions.
## Decisions & constraints
Choices already made, user preferences, things that must not change, and why.
## Open issues
Known failures, risks, unanswered questions.
## Read first
At most 5 file paths, only if the next chat truly needs them. Paths only, no contents.
```

**3. Quality limits**
- Total length under 6000 characters. Be dense; no filler.
- Reference code by `path:line`; never paste code blocks beyond a one-line signature.
- State facts only. No secrets, tokens, passwords or personal data.
- Do not repeat what CLAUDE.md or README already say.

**4. Finish**
After writing the file, reply with one short line saying it is saved and that the user can start a new chat (or run /clear) to continue. Then stop.
