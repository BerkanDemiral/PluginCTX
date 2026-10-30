// Stop hook: when the chat crosses the configured context threshold, ask Claude (once per
// session) to leave the work in a buildable state and write the handoff snapshot.

import fs from "node:fs";
import path from "node:path";
import {
  readStdin, projectDir, loadConfig, ensureStateDir, stateDir, contextTokens,
  skillBody, readJson, writeJson, emit, safeMain,
} from "./lib.mjs";

const MAX_ATTEMPTS = 2;

safeMain(() => {
  const input = readStdin();
  const sid = input.session_id;
  if (!sid || !input.transcript_path) return;

  const project = projectDir(input);
  const cfg = loadConfig(project);
  if (!cfg.enabled) return;

  const dir = stateDir(project);
  const snapshot = path.join(dir, "SNAPSHOT.md");
  const stateFile = path.join(dir, "state", `${sid.replace(/[^\w-]/g, "_")}.json`);
  const state = readJson(stateFile, null);

  // Phase 2: we asked for a snapshot earlier in this session; check whether it was written.
  if (state?.phase === "requested") {
    let fresh = false;
    try {
      fresh = fs.statSync(snapshot).mtimeMs >= state.requestedAt;
    } catch {
      /* not written */
    }
    if (fresh) {
      writeJson(stateFile, { ...state, phase: "done", doneAt: Date.now() });
      emit({
        systemMessage:
          "ctx-relay: snapshot saved to .claude/ctx-relay/SNAPSHOT.md. " +
          "Start a new chat (or run /clear): it will be loaded automatically.",
      });
    } else if (state.attempts < MAX_ATTEMPTS) {
      writeJson(stateFile, { ...state, attempts: state.attempts + 1 });
      emit({
        decision: "block",
        reason:
          "ctx-relay: the snapshot file .claude/ctx-relay/SNAPSHOT.md has not been written yet. " +
          "Write it now, following the handoff instructions you were given. Do nothing else.",
      });
    } else {
      writeJson(stateFile, { ...state, phase: "failed" });
      emit({
        systemMessage:
          "ctx-relay: no snapshot was written. You can run /ctx-relay:handoff yourself before switching chats.",
      });
    }
    return;
  }
  if (state) return; // done or failed: never nag twice in one session

  const used = contextTokens(input.transcript_path);
  if (used == null) return;
  // A usage above the default window can only mean a larger-window model.
  const window = used > cfg.contextWindow ? Math.max(1000000, used * 2) : cfg.contextWindow;
  const overTokens = cfg.triggerTokens > 0 && used >= cfg.triggerTokens;
  if (!overTokens && used / window < cfg.threshold) return;

  ensureStateDir(project);
  writeJson(stateFile, { phase: "requested", requestedAt: Date.now(), attempts: 1, usedTokens: used });
  prune(path.join(dir, "state"));

  const pct = Math.round((used / window) * 100);
  emit({
    decision: "block",
    reason:
      `ctx-relay: this chat holds ${used} tokens (~${pct}% of its context window). ` +
      `Do the handoff now and then stop. Do not start any new work.\n\n` +
      skillBody("handoff"),
  });
});

function prune(stateSubdir) {
  const cutoff = Date.now() - 7 * 24 * 3600 * 1000;
  try {
    for (const f of fs.readdirSync(stateSubdir)) {
      const p = path.join(stateSubdir, f);
      if (fs.statSync(p).mtimeMs < cutoff) fs.unlinkSync(p);
    }
  } catch {
    /* best effort */
  }
}
