import { spawn } from "node:child_process";
import { logAction, logError, withLogging } from "../lib/logger.js";

export interface CommandResult {
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Runs a command in repoRoot, streaming each output line through the logger
 * as it happens (not just at the end) so long builds stay visible while
 * they run, not just after they finish.
 */
function runStreamed(command: string, args: string[], cwd: string, action: string): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const full = [command, ...args].join(" ");
    const child = spawn(command, args, { cwd, shell: true });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      for (const line of text.split(/\r?\n/).filter(Boolean)) {
        logAction(`${action}: stdout`, { line });
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      for (const line of text.split(/\r?\n/).filter(Boolean)) {
        logError(`${action}: stderr`, { line });
      }
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      resolve({ command: full, exitCode, stdout, stderr });
    });
  });
}

/**
 * Runs Oracle's grunt-vb-build task against the checked-out VB Studio repo.
 * TODO: confirm the exact grunt task name/flags (e.g. "grunt vb-build",
 * task-specific target args) against the reference project's Gruntfile once
 * grunt-vb-build is installed from the private Oracle CDN feed — see README.
 */
export async function runBuild(repoRoot: string, appName?: string): Promise<CommandResult> {
  const args = ["grunt", "vb-build", ...(appName ? [`--app=${appName}`] : [])];
  return withLogging("runBuild", { repoRoot, appName }, () =>
    runStreamed("npx", args, repoRoot, "runBuild")
  );
}

/**
 * Runs Oracle's grunt-vb-audit task. Same TODO as runBuild: confirm exact
 * task name/flags once grunt-vb-audit is available in this environment.
 */
export async function runAudit(repoRoot: string, appName?: string): Promise<CommandResult> {
  const args = ["grunt", "vb-audit", ...(appName ? [`--app=${appName}`] : [])];
  return withLogging("runAudit", { repoRoot, appName }, () =>
    runStreamed("npx", args, repoRoot, "runAudit")
  );
}
