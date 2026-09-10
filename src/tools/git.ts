import path from "node:path";
import { simpleGit, type SimpleGit, type StatusResult } from "simple-git";
import { withLogging } from "../lib/logger.js";
import { resolveWorkspaceDir, VbcsRepoError } from "../lib/vbcs-repo.js";

function client(repoRoot: string): SimpleGit {
  return simpleGit({ baseDir: repoRoot });
}

/**
 * Clones a git remote into VBS_WORKSPACE_DIR/destName so it's immediately
 * discoverable by list_repos. Used by /link's VBS setup flow when the user
 * doesn't already have a local checkout.
 *
 * If this hangs instead of failing, the OS credential manager is likely
 * waiting on an interactive prompt with no terminal to show it (this is what
 * happened cloning TestRepo — see CLAUDE.md's existing-gaps session entry).
 * Check `git config --global --list | grep credential`; clear the cached
 * entry for the host if it's missing/wrong, or use an embedded-token remote
 * URL instead so no prompt is needed.
 */
export async function gitClone(remoteUrl: string, destName: string): Promise<{ path: string }> {
  return withLogging("gitClone", { remoteUrl, destName }, async () => {
    const workspace = resolveWorkspaceDir();
    if (!workspace) {
      throw new VbcsRepoError("VBS_WORKSPACE_DIR is not set — set it before cloning a repo into the workspace.");
    }
    const destPath = path.join(workspace, destName);
    await simpleGit().clone(remoteUrl, destPath);
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
    const git = client(repoRoot);
    const result = branch ? await git.pull(remote, branch) : await git.pull(remote);
    return result.summary.changes > 0
      ? `Pulled ${result.summary.changes} change(s) from ${remote}${branch ? "/" + branch : ""}`
      : "Already up to date";
  });
}

export async function gitPush(repoRoot: string, remote = "origin", branch?: string): Promise<string> {
  return withLogging("gitPush", { repoRoot, remote, branch }, async () => {
    const git = client(repoRoot);
    if (branch) {
      await git.push(remote, branch);
    } else {
      await git.push(remote);
    }
    return `Pushed to ${remote}${branch ? "/" + branch : ""}`;
  });
}
