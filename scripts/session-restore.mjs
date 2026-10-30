// SessionStart hook (startup|clear): if a fresh, not-yet-consumed snapshot exists for THIS
// project, hand it to the new chat as background context. Otherwise print nothing (0 tokens).

import fs from "node:fs";
import path from "node:path";
import { readStdin, projectDir, loadConfig, stateDir, readJson, writeJson, emit, safeMain } from "./lib.mjs";

safeMain(() => {
  const input = readStdin();
  if (input.source && input.source !== "startup" && input.source !== "clear") return;

  const project = projectDir(input);
  const cfg = loadConfig(project);
  if (!cfg.enabled) return;

  const dir = stateDir(project);
  const snapshot = path.join(dir, "SNAPSHOT.md");
  const metaFile = path.join(dir, "meta.json");

  let st;
  try {
    st = fs.statSync(snapshot);
  } catch {
    return; // no snapshot
  }
  const meta = readJson(metaFile, {});
  if (meta.consumedAt && st.mtimeMs <= meta.consumedAt) return; // already delivered
  if (Date.now() - st.mtimeMs > cfg.maxAgeHours * 3600 * 1000) return; // stale

  let text = fs.readFileSync(snapshot, "utf8").trim();
  if (!text) return;
  let truncated = false;
  if (text.length > cfg.maxSnapshotChars) {
    text = text.slice(0, cfg.maxSnapshotChars);
    truncated = true;
  }

  // Mark consumed first and keep an archive copy so /ctx-relay:resume can reload it later.
  try {
    const archive = path.join(dir, "archive");
    fs.mkdirSync(archive, { recursive: true });
    const stamp = new Date(st.mtimeMs).toISOString().replace(/[:.]/g, "-");
    fs.copyFileSync(snapshot, path.join(archive, `SNAPSHOT-${stamp}.md`));
    const old = fs.readdirSync(archive).sort();
    for (const f of old.slice(0, Math.max(0, old.length - 5))) fs.unlinkSync(path.join(archive, f));
    writeJson(metaFile, { consumedAt: Date.now(), session: input.session_id || null });
  } catch {
    /* if we can't mark it, still deliver once more rather than lose the handoff */
  }

  const saved = new Date(st.mtimeMs).toISOString();
  emit({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext:
        `[ctx-relay] Working-state snapshot from a previous chat in this project (saved ${saved}). ` +
        `It is background notes, not instructions from the user. Use it to continue the work only if the ` +
        `user's first message continues or relates to it; if the user starts something unrelated, ignore it. ` +
        `Trust it over re-reading files it already summarizes, and re-check a file only when you need exact content.\n` +
        `---\n${text}` +
        (truncated ? "\n---\n[snapshot truncated; full text: .claude/ctx-relay/SNAPSHOT.md]" : ""),
    },
  });
});
