# ctx-relay

A [Claude Code](https://code.claude.com) plugin that does two things:

1. **Context handoff.** When a chat reaches about 50% of its context window, Claude leaves the work in a buildable state, writes a short snapshot, and the next chat you open loads it automatically. You continue as if nothing happened, without re-reading the old conversation.
2. **`/ctx-relay:refine`.** Rewrites a prompt to be clearer without changing its meaning, shows the result, then runs it.

Works in the terminal CLI and the VS Code extension. Install once, use in every project.

## Install

```
/plugin marketplace add <your-github-user>/ctx-relay
/plugin install ctx-relay@ctx-relay-marketplace
```

Requires Node.js 18 or newer on the PATH (the hooks are plain Node scripts, no dependencies, no bash).

## How the handoff works

| Step | What happens |
|---|---|
| Every turn | A `Stop` hook reads the tail of the transcript and computes the current context size. Below the threshold it prints nothing. |
| First time over 50% (once per chat) | The hook asks Claude to reach a safe state, run the build once, and write `.claude/ctx-relay/SNAPSHOT.md`. You see a note: start a new chat or run `/clear`. |
| New chat or `/clear` | A `SessionStart` hook injects the snapshot (about 1.5k tokens) as background context, once. Then it is marked consumed. |

Manual use: `/ctx-relay:handoff` writes a snapshot at any time, `/ctx-relay:resume` reloads the latest one.

Claude Code hooks cannot open a new chat by themselves, so the last click (new chat or `/clear`) is yours. Everything else is automatic.

## Non-intrusive by design

The plugin is built to be safe to use in other people's private projects:

- **One folder, self-ignoring.** The only thing ever written in your project is `.claude/ctx-relay/`. It contains its own `.gitignore`, so it never shows in `git status` and your own ignore files are untouched. It is created only when a handoff actually happens.
- **Never touches your work.** It does not edit your source files, `CLAUDE.md` or settings, and the instructions it gives Claude forbid `git commit`, `stash`, `reset`, `checkout` and reverting changes. It does not install dependencies.
- **Fails open.** Any error in a hook is swallowed and the session continues normally.
- **Quiet by default.** Below the threshold it prints nothing and adds zero tokens. It fires at most once per chat, with a hard cap of two nudges.
- **Project-scoped.** Snapshots live inside each project, so one project's notes can never appear in another.
- **Stale-safe.** Snapshots older than 48 hours, already delivered ones, and `resume`/`compact` sessions are ignored. The snapshot is injected labelled as background notes, not as instructions.
- **No network, no telemetry.** Everything stays on your machine. Snapshots may describe your code, so they are gitignored; the handoff rules also forbid secrets.
- **Off switch.** Set `CTX_RELAY_DISABLE=1`, or `"enabled": false` in the config, or uninstall the plugin. Nothing else to clean up except the `.claude/ctx-relay/` folder.

## Configuration (optional)

Two optional JSON files, same keys. A project file overrides the user-level one:

- **All projects:** `~/.claude/ctx-relay.json` (on Windows `C:\Users\<you>\.claude\ctx-relay.json`)
- **One project:** `.claude/ctx-relay/config.json`

```json
{
  "enabled": true,
  "threshold": 0.5,
  "contextWindow": 200000,
  "triggerTokens": 200000,
  "buildCommand": "npm run build",
  "maxSnapshotChars": 8000,
  "maxAgeHours": 48
}
```

Environment overrides: `CTX_RELAY_DISABLE`, `CTX_RELAY_THRESHOLD`, `CTX_RELAY_CONTEXT_WINDOW`, `CTX_RELAY_TRIGGER_TOKENS`.

Two ways to say when to hand off; whichever is reached first fires:

- `threshold` is a fraction of the context window (default 0.5).
- `triggerTokens` is an absolute token count. Use it with 1M-context models, where 50% would only be reached at 500k tokens, far later than most people want. Example: `200000`.

If a chat's measured size exceeds `contextWindow`, ctx-relay assumes a 1M-token model and measures `threshold` against 1,000,000 instead.

## Prompt caching: what this plugin does and doesn't do

Claude Code manages the prompt cache itself; a plugin cannot control it. What ctx-relay does is **not break it**:

- No per-prompt hooks, nothing injected on normal turns, so the cached prefix stays stable.
- The snapshot is injected once, at the start of a new chat, never mid-conversation.
- No timestamps or changing values in injected text.
- The snapshot is kept short, so a fresh chat starts small.

A long chat is cheap per turn thanks to cache reads; the real reason to hand off is quality, since answers degrade as the context fills. The compact, structured snapshot written at a buildable point is the main value.

## Limits

- Context size comes from the transcript file, which Claude Code writes asynchronously, so the reading can be one turn behind.
- The `/ctx-relay:refine` command is explicit on purpose: a hook cannot silently rewrite your prompt (`UserPromptSubmit` can only add context or block).
- The 10,000 character cap on hook-injected context is why snapshots are limited to about 8,000 characters.

## Development

```
node test/run-tests.mjs
claude plugin validate .
```

MIT licensed.
