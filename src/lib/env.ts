import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

/**
 * Package root by file location, not process.cwd() — MCP hosts (Claude Code,
 * etc) can launch this server from an arbitrary working directory, so
 * relying on cwd would silently drop all config.
 */
export function resolveProjectRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..", "..");
}

/** True when running from a git clone / source tree (has src/), false for an npm/npx install. */
export function isSourceCheckout(): boolean {
  return fs.existsSync(path.join(resolveProjectRoot(), "src"));
}

/** Per-user config directory used by npm/npx/global installs, where the package folder isn't a place anyone edits. */
export function userConfigDir(): string {
  return path.join(os.homedir(), ".ovb3");
}

/**
 * The .env file this install reads and `ovb3 init` writes:
 *   OVB3_ENV_FILE (explicit) > <clone>/.env (source checkout) > ~/.ovb3/.env (npm/npx/global install).
 */
export function resolveEnvFile(): string {
  if (process.env.OVB3_ENV_FILE) return path.resolve(process.env.OVB3_ENV_FILE);
  return isSourceCheckout() ? path.join(resolveProjectRoot(), ".env") : path.join(userConfigDir(), ".env");
}

/** Where `ovb3 init` suggests keeping repo checkouts by default. */
export function defaultWorkspaceDir(): string {
  return isSourceCheckout() ? path.join(resolveProjectRoot(), "workspace") : path.join(userConfigDir(), "workspace");
}

const UNEXPANDED_PLACEHOLDER = /^\$\{[^}]*\}$/;

/**
 * Host-provided placeholders that arrive empty ("") or unexpanded
 * ("${user_config.x}") mean "not configured" — drop them so a real value from
 * .env can still apply (dotenv never overrides a variable that is already set).
 */
export function dropUnsetPlaceholders(env: NodeJS.ProcessEnv = process.env): void {
  for (const [key, value] of Object.entries(env)) {
    if (value === "" || (value !== undefined && UNEXPANDED_PLACEHOLDER.test(value))) delete env[key];
  }
}

/**
 * Loads config. Precedence (highest first): real environment variables (e.g.
 * Claude Code plugin config) > ./.env in the current directory > the install's
 * own .env (see resolveEnvFile). dotenv never overrides an already-set
 * variable, so loading highest-priority sources first gives exactly that order.
 */
export function loadEnv(): void {
  dropUnsetPlaceholders();
  dotenv.config({ path: path.join(process.cwd(), ".env"), quiet: true });
  dotenv.config({ path: resolveEnvFile(), quiet: true });
}
