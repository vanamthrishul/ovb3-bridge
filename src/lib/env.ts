import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

/**
 * Project root by file location, not process.cwd() — MCP hosts (Claude Code,
 * etc) can launch this server from an arbitrary working directory, so
 * relying on cwd would silently drop all config. Shared with env-writer.ts
 * so both modules agree on where .env lives.
 */
export function resolveProjectRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..", "..");
}

/** Loads .env from the project root. */
export function loadEnv(): void {
  dotenv.config({ path: path.join(resolveProjectRoot(), ".env") });
}
