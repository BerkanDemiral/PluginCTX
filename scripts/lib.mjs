// Shared helpers for ctx-relay hooks.
//
// Safety contract (see README "Non-intrusive by design"):
//  - every hook fails open: any error => exit 0 with no output, never break the session
//  - the only place we write is <project>/.claude/ctx-relay/ (self-ignoring via its own .gitignore)
//  - we never touch git, CLAUDE.md, settings, or any user file

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const pluginRoot = path.resolve(here, "..");

export const DEFAULTS = {
  enabled: true,
  threshold: 0.5, // fraction of the context window
  contextWindow: 200000, // tokens; raise to 1000000 for 1M-context models
  triggerTokens: null, // optional absolute trigger (e.g. 200000), independent of the window size
  maxSnapshotChars: 8000, // SessionStart additionalContext is capped at 10k chars
  maxAgeHours: 48, // older snapshots are ignored
  buildCommand: null, // optional, e.g. "npm run build"
};

export function readStdin() {
  try {
    const raw = fs.readFileSync(0, "utf8").replace(/^﻿/, "");
    return raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function projectDir(input) {
  return process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
}

export function stateDir(project) {
  return path.join(project, ".claude", "ctx-relay");
}

// Precedence (low to high): defaults, user-level ~/.claude/ctx-relay.json (all projects),
// project-level .claude/ctx-relay/config.json, environment variables.
export function loadConfig(project) {
  const globalFile =
    process.env.CTX_RELAY_GLOBAL_CONFIG || path.join(os.homedir(), ".claude", "ctx-relay.json");
  const cfg = {
    ...DEFAULTS,
    ...readJson(globalFile, {}),
    ...readJson(path.join(stateDir(project), "config.json"), {}),
  };
  if (process.env.CTX_RELAY_DISABLE === "1") cfg.enabled = false;
  if (process.env.CTX_RELAY_TRIGGER_TOKENS) {
    const n = Number(process.env.CTX_RELAY_TRIGGER_TOKENS);
    if (n > 0) cfg.triggerTokens = n;
  }
  if (process.env.CTX_RELAY_THRESHOLD) {
    const t = Number(process.env.CTX_RELAY_THRESHOLD);
    if (t > 0 && t < 1) cfg.threshold = t;
  }
  if (process.env.CTX_RELAY_CONTEXT_WINDOW) {
    const w = Number(process.env.CTX_RELAY_CONTEXT_WINDOW);
    if (w > 0) cfg.contextWindow = w;
  }
  return cfg;
}

// Created lazily, only when ctx-relay actually has something to write.
// The inner .gitignore keeps the folder out of `git status` without touching the user's own ignore files.
export function ensureStateDir(project) {
  const dir = stateDir(project);
  fs.mkdirSync(path.join(dir, "state"), { recursive: true });
  const gi = path.join(dir, ".gitignore");
  if (!fs.existsSync(gi)) {
    fs.writeFileSync(gi, "*\n!.gitignore\n!config.json\n", "utf8");
  }
  return dir;
}

// Current context size = the prompt of the latest main-chain API call plus its output.
// Reads only the tail of the transcript. Returns null when it can't be determined.
export function contextTokens(transcriptPath) {
  try {
    const fd = fs.openSync(transcriptPath, "r");
    try {
      const size = fs.fstatSync(fd).size;
      const len = Math.min(size, 512 * 1024);
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, size - len);
      const lines = buf.toString("utf8").split("\n");
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim();
        if (!line) continue;
        let e;
        try {
          e = JSON.parse(line);
        } catch {
          continue; // partial first line of the tail slice, or a half-written last line
        }
        const u = e?.message?.usage;
        if (e?.type !== "assistant" || !u || e.isSidechain || e.isApiErrorMessage) continue;
        if (e.message?.model === "<synthetic>") continue;
        return (
          (u.input_tokens || 0) +
          (u.cache_creation_input_tokens || 0) +
          (u.cache_read_input_tokens || 0) +
          (u.output_tokens || 0)
        );
      }
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    /* fall through */
  }
  return null;
}

// Body of a bundled skill without its frontmatter: single source of truth for the
// instructions that both the slash command and the hook hand to Claude.
export function skillBody(name) {
  const text = fs.readFileSync(path.join(pluginRoot, "skills", name, "SKILL.md"), "utf8");
  return text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "").trim();
}

export function readJson(file, fallback = null) {
  try {
    // Windows editors (Notepad, PowerShell 5.1) may prepend a UTF-8 BOM, which JSON.parse rejects.
    return JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, ""));
  } catch {
    return fallback;
  }
}

export function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

export function emit(obj) {
  process.stdout.write(JSON.stringify(obj));
}

export function safeMain(fn) {
  try {
    fn();
  } catch {
    /* fail open */
  }
  process.exit(0);
}
