// End-to-end test: fake project + fake transcript, real hook processes. Run: node test/run-tests.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const guard = path.join(root, "scripts", "context-guard.mjs");
const restore = path.join(root, "scripts", "session-restore.mjs");

let failed = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  " + extra}`);
  if (!ok) failed++;
};

function run(script, input, env = {}) {
  const r = spawnSync("node", [script], {
    input: typeof input === "string" ? input : JSON.stringify(input),
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return { code: r.status, out: r.stdout.trim(), err: r.stderr.trim() };
}

function transcript(file, tokens) {
  const line = (o) => JSON.stringify(o) + "\n";
  fs.writeFileSync(
    file,
    line({ type: "user", message: { role: "user", content: "hi" } }) +
      line({ type: "assistant", message: { model: "claude-x", usage: { input_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: tokens - 105, output_tokens: 100 } } }) +
      line({ type: "assistant", isSidechain: true, message: { model: "claude-x", usage: { input_tokens: 999999 } } }) +
      '{"type":"assistant","message":{"usage":', // half-written last line
  );
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-relay-"));
const proj = path.join(tmp, "proj");
fs.mkdirSync(proj);
fs.writeFileSync(path.join(proj, "app.js"), "console.log(1)\n");
const tr = path.join(tmp, "t.jsonl");
const globalCfg = path.join(tmp, "global-config.json"); // never read the developer's real ~/.claude/ctx-relay.json
const env = { CLAUDE_PROJECT_DIR: proj, CTX_RELAY_GLOBAL_CONFIG: globalCfg };
const base = { session_id: "s1", transcript_path: tr, cwd: proj, hook_event_name: "Stop" };
const listing = () => fs.readdirSync(proj).sort().join(",");

// 1. below threshold: silent, writes nothing
transcript(tr, 60000);
let r = run(guard, base, env);
check("below threshold: no output", r.code === 0 && r.out === "");
check("below threshold: project untouched", listing() === "app.js", listing());

// 2. garbage / empty input never breaks the session
r = run(guard, "not json", env);
check("garbage stdin: exit 0, silent", r.code === 0 && r.out === "");
r = run(guard, { session_id: "s1", transcript_path: path.join(tmp, "missing.jsonl") }, env);
check("missing transcript: exit 0, silent", r.code === 0 && r.out === "");

// 3. kill switches
transcript(tr, 120000);
r = run(guard, base, { ...env, CTX_RELAY_DISABLE: "1" });
check("CTX_RELAY_DISABLE=1: silent", r.out === "");

// 4. at 60%: block once with handoff instructions
r = run(guard, base, env);
let j = r.out ? JSON.parse(r.out) : {};
check("above threshold: blocks", j.decision === "block" && /SNAPSHOT\.md/.test(j.reason || ""), r.out.slice(0, 200));
check("reason carries the handoff skill", /Reach a safe state/.test(j.reason || ""));
check("reason forbids destructive git", /Never discard, revert, stash/.test(j.reason || ""));
check("only .claude/ added to project", listing() === ".claude,app.js", listing());
const gi = fs.readFileSync(path.join(proj, ".claude", "ctx-relay", ".gitignore"), "utf8");
check("self-ignoring .gitignore", gi.startsWith("*"));

// 5. snapshot not written yet: one more nudge, then give up
r = run(guard, { ...base, stop_hook_active: true }, env);
check("no snapshot: second nudge", JSON.parse(r.out).decision === "block");
r = run(guard, { ...base, stop_hook_active: true }, env);
check("no snapshot: gives up politely", /no snapshot was written/.test(JSON.parse(r.out).systemMessage || ""), r.out);
r = run(guard, base, env);
check("after giving up: never nags again", r.out === "");

// 6. fresh session, snapshot written by Claude -> finalize message
const base2 = { ...base, session_id: "s2" };
fs.rmSync(path.join(proj, ".claude", "ctx-relay", "state"), { recursive: true });
run(guard, base2, env); // request
const snap = path.join(proj, ".claude", "ctx-relay", "SNAPSHOT.md");
fs.writeFileSync(snap, "# Snapshot: 2026-10-30\n## Goal\nTest goal\n## Next steps\n1. Do the thing\n");
r = run(guard, { ...base2, stop_hook_active: true }, env);
check("snapshot written: user told to start a new chat", /Start a new chat/.test(JSON.parse(r.out).systemMessage || ""), r.out);
r = run(guard, base2, env);
check("after done: silent", r.out === "");

// 7. restore
const startInput = { session_id: "n1", cwd: proj, hook_event_name: "SessionStart", source: "startup" };
r = run(restore, { ...startInput, source: "resume" }, env);
check("resume source: nothing injected", r.out === "");
r = run(restore, startInput, env);
j = r.out ? JSON.parse(r.out) : {};
const ctx = j.hookSpecificOutput?.additionalContext || "";
check("startup: snapshot injected", /Do the thing/.test(ctx) && j.hookSpecificOutput.hookEventName === "SessionStart", r.out.slice(0, 200));
check("injection framed as background, not instructions", /not instructions from the user/.test(ctx));
r = run(restore, startInput, env);
check("second new chat: not injected again", r.out === "");
check("archive copy kept", fs.readdirSync(path.join(proj, ".claude", "ctx-relay", "archive")).length === 1);

// 8. stale snapshot ignored; oversized truncated
fs.writeFileSync(snap, "x".repeat(20000));
r = run(restore, { ...startInput, source: "clear" }, env);
const big = JSON.parse(r.out).hookSpecificOutput.additionalContext;
check("oversized snapshot truncated under 10k chars", big.length < 10000 && /truncated/.test(big), String(big.length));
fs.writeFileSync(snap, "old");
const old = new Date(Date.now() - 72 * 3600 * 1000);
fs.utimesSync(snap, old, old);
r = run(restore, startInput, env);
check("stale (>48h) snapshot ignored", r.out === "");

// 9. other project is unaffected
const other = path.join(tmp, "other");
fs.mkdirSync(other);
r = run(restore, { ...startInput, cwd: other }, { CLAUDE_PROJECT_DIR: other });
check("other project: nothing injected, nothing written", r.out === "" && fs.readdirSync(other).length === 0);

// 10. 1M-context model: 300k tokens is 30%, must not trigger
transcript(tr, 300000);
r = run(guard, { ...base, session_id: "s3" }, env);
check("300k tokens on a larger window (<50%): silent", r.out === "", r.out.slice(0, 120));
transcript(tr, 700000);
r = run(guard, { ...base, session_id: "s4" }, env);
check("700k tokens (>50% of 1M): blocks", /"decision":"block"/.test(r.out));

// 11. absolute trigger: 226k tokens on a 1M window (22%) fires when triggerTokens=200000
transcript(tr, 226000);
r = run(guard, { ...base, session_id: "s5" }, { ...env, CTX_RELAY_TRIGGER_TOKENS: "200000" });
check("triggerTokens via env: fires at 226k on 1M window", /"decision":"block"/.test(r.out), r.out.slice(0, 120));
r = run(guard, { ...base, session_id: "s6" }, env);
check("without triggerTokens: 226k on 1M window stays silent", r.out === "");
fs.writeFileSync(globalCfg, JSON.stringify({ triggerTokens: 200000 }));
r = run(guard, { ...base, session_id: "s7" }, env);
check("triggerTokens via user-level config file fires", /"decision":"block"/.test(r.out), r.out.slice(0, 120));
fs.writeFileSync(path.join(proj, ".claude", "ctx-relay", "config.json"), JSON.stringify({ enabled: false }));
r = run(guard, { ...base, session_id: "s8" }, env);
check("project config overrides user-level config", r.out === "");
transcript(tr, 150000);
fs.writeFileSync(path.join(proj, ".claude", "ctx-relay", "config.json"), JSON.stringify({ contextWindow: 1000000 }));
r = run(guard, { ...base, session_id: "s9" }, env);
check("150k on 1M window, below triggerTokens 200k: silent", r.out === "", r.out.slice(0, 120));

// 12. config files saved with a UTF-8 BOM (Notepad, PowerShell 5.1) still work
transcript(tr, 226000);
fs.writeFileSync(globalCfg, "﻿" + JSON.stringify({ triggerTokens: 200000 }));
fs.writeFileSync(path.join(proj, ".claude", "ctx-relay", "config.json"), "﻿{}");
r = run(guard, { ...base, session_id: "s10" }, env);
check("BOM-prefixed config files are read", /"decision":"block"/.test(r.out), r.out.slice(0, 120));

fs.rmSync(tmp, { recursive: true, force: true });
console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
