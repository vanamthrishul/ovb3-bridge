import fs from "node:fs";
import path from "node:path";

import { resolveProjectRoot } from "./env.js";

/**
 * Writes to the local .env file directly — the CLI equivalent of what
 * /link's Edit-tool-based flow does inside Claude Code. Only ever used for
 * the same non-secret fields /link is allowed to touch (VBS_WORKSPACE_DIR,
 * VBCS_REPO_PATH, VBCS_APP_NAME, VBCS_BASE_URL); credentials are always the
 * user's to fill in by hand, never written here.
 */

function envPath(): string {
  return path.join(resolveProjectRoot(), ".env");
}

/** Creates .env from .env.example if it doesn't exist yet. Returns the .env path and whether it was just created. */
export function ensureEnvFile(): { path: string; created: boolean } {
  const target = envPath();
  if (fs.existsSync(target)) {
    return { path: target, created: false };
  }
  const example = path.join(resolveProjectRoot(), ".env.example");
  const seed = fs.existsSync(example) ? fs.readFileSync(example, "utf8") : "";
  fs.writeFileSync(target, seed, "utf8");
  return { path: target, created: true };
}

/**
 * Updates specific KEY=value lines in .env, preserving every other line
 * (comments, unrelated values, ordering). Appends a key at the end if it
 * isn't already present. Also mirrors each value into process.env so the
 * rest of the current process (e.g. a later gitClone() call in the same
 * `ovb3 init` run) sees it immediately — dotenv only loads .env once at
 * startup, before these writes happen.
 */
export function upsertEnvVars(updates: Record<string, string>): void {
  const target = ensureEnvFile().path;
  const lines = fs.readFileSync(target, "utf8").split("\n");
  const remaining = new Map(Object.entries(updates));

  const next = lines.map((line) => {
    const match = /^([A-Z0-9_]+)=/.exec(line);
    if (!match) return line;
    const key = match[1];
    if (!remaining.has(key)) return line;
    const value = remaining.get(key)!;
    remaining.delete(key);
    return `${key}=${value}`;
  });

  for (const [key, value] of remaining) {
    next.push(`${key}=${value}`);
  }

  fs.writeFileSync(target, next.join("\n"), "utf8");
  for (const [key, value] of Object.entries(updates)) {
    process.env[key] = value;
  }
}
