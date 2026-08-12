import fs from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import { resolveArtifactPath, VbcsRepoError, listRepos as listReposSync, listApps as listAppsSync } from "../lib/vbcs-repo.js";
import { withLogging } from "../lib/logger.js";

/** Local project repo checkouts discoverable under VBS_WORKSPACE_DIR. */
export async function listRepos(): Promise<string[]> {
  return withLogging("listRepos", {}, async () => listReposSync());
}

/** VBCS web app names present in a given repo checkout (webApps/<app>/). */
export async function listApps(repoRoot: string): Promise<string[]> {
  return withLogging("listApps", { repoRoot }, async () => listAppsSync(repoRoot));
}

export interface ReadArtifactResult {
  path: string;
  isJson: boolean;
  content: string;
}

export async function readArtifact(repoRoot: string, relativePath: string): Promise<ReadArtifactResult> {
  return withLogging("readArtifact", { path: relativePath }, async () => {
    const abs = resolveArtifactPath(repoRoot, relativePath);
    const raw = await fs.readFile(abs, "utf8");
    const isJson = abs.endsWith(".json");
    if (isJson) {
      // Validate shape early so callers don't push broken JSON back to VB Studio.
      JSON.parse(raw);
    }
    return { path: relativePath, isJson, content: raw };
  });
}

export async function writeArtifact(
  repoRoot: string,
  relativePath: string,
  content: string
): Promise<{ path: string; bytesWritten: number }> {
  return withLogging("writeArtifact", { path: relativePath }, async () => {
    const abs = resolveArtifactPath(repoRoot, relativePath);
    if (abs.endsWith(".json")) {
      try {
        JSON.parse(content);
      } catch (err) {
        throw new VbcsRepoError(`Refusing to write invalid JSON to ${relativePath}: ${(err as Error).message}`);
      }
    }
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, "utf8");
    return { path: relativePath, bytesWritten: Buffer.byteLength(content, "utf8") };
  });
}

export async function listArtifacts(repoRoot: string, pattern: string): Promise<string[]> {
  return withLogging("listArtifacts", { pattern }, async () => {
    const matches = await fg(pattern, { cwd: repoRoot, dot: false, onlyFiles: true });
    return matches.sort();
  });
}
