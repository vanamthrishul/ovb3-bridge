import fs from "node:fs";
import path from "node:path";
import { simpleGit, type SimpleGit, type StatusResult } from "simple-git";
import { withLogging } from "../lib/logger.js";
import { configuredWorkspaceDir, VbcsRepoError } from "../lib/vbcs-repo.js";

const DEFAULT_GIT_TIMEOUT_MS = 120_000;

function timeoutMs(): number {
  const raw = Number(process.env.OVB3_GIT_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_GIT_TIMEOUT_MS;
}

/**
 * Builds the `http.<origin>/.extraHeader` config that authenticates git over
 * HTTPS with VBSTUDIO_GIT_USERNAME / VBSTUDIO_GIT_TOKEN. Sent as a scoped
 * header rather than embedded in the remote URL so the secret never lands in
 * .git/config, `git remote -v`, process listings, or logs - and scoped to the
 * remote's own origin so it is never sent to a redirect target on another host.
 * Returns [] when no token is configured or the remote isn't http(s) (e.g. ssh).
 */
export function authConfigFor(remoteUrl: string): string[] {
  const username = process.env.VBSTUDIO_GIT_USERNAME;
  const token = process.env.VBSTUDIO_GIT_TOKEN;
  if (!username || !token) return [];
  let origin: string;
  try {
    const url = new URL(remoteUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") return [];
    origin = `${url.protocol}//${url.host}/`;
  } catch {
    return [];
  }
  const basic = Buffer.from(`${username}:${token}`).toString("base64");
  return [`http.${origin}.extraHeader=Authorization: Basic ${basic}`];
}

function identityConfig(): string[] {
  const config: string[] = [];
  if (process.env.VBSTUDIO_GIT_USER_NAME) config.push(`user.name=${process.env.VBSTUDIO_GIT_USER_NAME}`);
  if (process.env.VBSTUDIO_GIT_USER_EMAIL) config.push(`user.email=${process.env.VBSTUDIO_GIT_USER_EMAIL}`);
  return config;
}

/**
 * Environment for git children. Inherits everything EXCEPT git's programmable
 * hooks - GIT_ASKPASS / SSH_ASKPASS (set by editors like VS Code; the exact
 * mechanism that pops an invisible prompt and hangs a headless run),
 * GIT_EDITOR, GIT_PAGER, GIT_SSH_COMMAND, GIT_EXTERNAL_DIFF, EDITOR, PAGER, ...,
 * which are also what simple-git refuses to run with. Only GIT_* variables
 * that matter for proxies/TLS (GIT_SSL_*, GIT_HTTP_*, GIT_CURL_*) and tracing
 * are kept. Terminal and credential-manager prompts are switched off.
 */
const KEEP_GIT_VARS = /^(GIT_SSL_|GIT_HTTP_|GIT_CURL_|GIT_TRACE)/;
const DROP_VARS = new Set(["SSH_ASKPASS", "EDITOR", "VISUAL", "PAGER"]);

export function nonInteractiveEnv(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined || DROP_VARS.has(key)) continue;
    if (key.startsWith("GIT_") && !KEEP_GIT_VARS.test(key)) continue;
    env[key] = value;
  }
  env.GIT_TERMINAL_PROMPT = "0";
  env.GCM_INTERACTIVE = "never";
  return env;
}

/**
 * A git client that can never hang on an invisible credential prompt: prompts
 * are disabled (GIT_TERMINAL_PROMPT / GCM_INTERACTIVE) so a missing credential
 * fails fast with git's own message, and a hard block-timeout kills a stalled
 * network operation. Cached credentials in the OS credential manager still work.
 */
function client(baseDir: string, extraConfig: string[] = []): SimpleGit {
  return simpleGit({
    baseDir,
    timeout: { block: timeoutMs() },
    config: [...extraConfig, ...identityConfig()],
  }).env(nonInteractiveEnv());
}

async function remoteUrlOf(repoRoot: string, remote: string): Promise<string> {
  try {
    return (await client(repoRoot).remote(["get-url", remote]))?.toString().trim() ?? "";
  } catch {
    return "";
  }
}

/** Turns git's opaque non-interactive auth failures into an actionable message. */
function explainGitError(err: unknown): Error {
  const message = err instanceof Error ? err.message : String(err);
  if (/terminal prompts disabled|could not read (username|password)|authentication failed|HTTP 401|403/i.test(message)) {
    return new Error(
      `${message}\n\nGit needs credentials for this remote. Set VBSTUDIO_GIT_USERNAME and VBSTUDIO_GIT_TOKEN ` +
        `(a VB Studio personal access token) in .env / plugin config - if they are already set, the token has likely ` +
        `expired or been revoked, so generate a new one. Or authenticate once in a normal terminal so your OS credential manager caches them.`
    );
  }
  if (/block timeout|timed out/i.test(message)) {
    return new Error(
      `${message}\n\nThe git operation stalled for ${timeoutMs() / 1000}s and was stopped. Check the host in the remote URL ` +
        `is reachable (a stale host in an old URL is a common cause), then retry. Raise OVB3_GIT_TIMEOUT_MS for very large repos.`
    );
  }
  return err instanceof Error ? err : new Error(message);
}

/**
 * Clones a git remote into VBS_WORKSPACE_DIR/destName so it's immediately
 * discoverable by list_repos. Used by /link's VBS setup flow when the user
 * doesn't already have a local checkout.
 */
export async function gitClone(remoteUrl: string, destName: string): Promise<{ path: string }> {
  return withLogging("gitClone", { remoteUrl, destName }, async () => {
    const workspace = configuredWorkspaceDir();
    if (!workspace) {
      throw new VbcsRepoError("VBS_WORKSPACE_DIR is not set - set it before cloning a repo into the workspace.");
    }
    if (fs.existsSync(workspace) && !fs.statSync(workspace).isDirectory()) {
      throw new VbcsRepoError(`VBS_WORKSPACE_DIR is not a directory: ${workspace}`);
    }
    fs.mkdirSync(workspace, { recursive: true });
    if (!/^[\w][\w.-]*$/.test(destName)) {
      throw new VbcsRepoError(`Invalid destName "${destName}" - use a plain folder name (letters, digits, '.', '_', '-').`);
    }
    const destPath = path.join(workspace, destName);
    try {
      await client(workspace, authConfigFor(remoteUrl)).clone(remoteUrl, destPath);
    } catch (err) {
      throw explainGitError(err);
    }
    return { path: destPath };
  });
}

export async function gitStatus(repoRoot: string): Promise<StatusResult> {
  return withLogging("gitStatus", { repoRoot }, () => client(repoRoot).status());
}

export async function gitCommit(
  repoRoot: string,
  message: string,
  files?: string[]
): Promise<{ commit: string; summary: { changes: number; insertions: number; deletions: number } }> {
  return withLogging("gitCommit", { repoRoot, message, files }, async () => {
    const git = client(repoRoot);
    await git.add(files && files.length > 0 ? files : ".");
    const result = await git.commit(message);
    return {
      commit: result.commit,
      summary: {
        changes: result.summary.changes,
        insertions: result.summary.insertions,
        deletions: result.summary.deletions,
      },
    };
  });
}

export async function gitPull(repoRoot: string, remote = "origin", branch?: string): Promise<string> {
  return withLogging("gitPull", { repoRoot, remote, branch }, async () => {
    const git = client(repoRoot, authConfigFor(await remoteUrlOf(repoRoot, remote)));
    try {
      const result = branch ? await git.pull(remote, branch) : await git.pull(remote);
      return result.summary.changes > 0
        ? `Pulled ${result.summary.changes} change(s) from ${remote}${branch ? "/" + branch : ""}`
        : "Already up to date";
    } catch (err) {
      throw explainGitError(err);
    }
  });
}

export async function gitPush(repoRoot: string, remote = "origin", branch?: string): Promise<string> {
  return withLogging("gitPush", { repoRoot, remote, branch }, async () => {
    const git = client(repoRoot, authConfigFor(await remoteUrlOf(repoRoot, remote)));
    try {
      if (branch) {
        await git.push(remote, branch);
      } else {
        await git.push(remote);
      }
    } catch (err) {
      throw explainGitError(err);
    }
    return `Pushed to ${remote}${branch ? "/" + branch : ""}`;
  });
}
