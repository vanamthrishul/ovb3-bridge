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
 * Component Exchange URL flag shared by vb-build and vb-audit. Confirmed
 * required (not optional) by actually running both tasks against a real app
 * with shared components: vb-build fails outright with "Fatal error: Missing
 * mandatory component exchange URL" without it, and vb-audit logs a
 * ComponentExchangeCCAFinder "Cannot load" error per component. Org-specific
 * — never hardcode a real value here; read from VB_BUILD_COMPONENT_EXCHANGE_URL
 * and omit the flag entirely if it's unset (so behavior degrades to Oracle's
 * own clear error rather than us guessing a URL).
 */
function componentExchangeArgs(): string[] {
  const url = process.env.VB_BUILD_COMPONENT_EXCHANGE_URL;
  return url ? [`--url:ce=${url}`] : [];
}

/**
 * Runs Oracle's grunt-vb-build task against the checked-out VB Studio repo.
 * Task name ("vb-build") and --app=<name> targeting are both confirmed
 * correct by reading the installed @oracle/grunt-vb-build source
 * (tasks_esm/build.js: grunt.registerTask('vb-build', ...)) and by actually
 * running it against a real app. Without VB_BUILD_COMPONENT_EXCHANGE_URL set,
 * this will fail on any app with shared/custom components (the normal case)
 * with Oracle's own "Missing mandatory component exchange URL" fatal error —
 * that's expected, not a bug in this wrapper.
 */
export async function runBuild(repoRoot: string, appName?: string): Promise<CommandResult> {
  const args = ["grunt", "vb-build", ...(appName ? [`--app=${appName}`] : []), ...componentExchangeArgs()];
  return withLogging("runBuild", { repoRoot, appName }, () =>
    runStreamed("npx", args, repoRoot, "runBuild")
  );
}

/**
 * Runs Oracle's grunt-vb-audit task. Task name ("vb-audit") confirmed correct
 * the same way as runBuild (source: tasks/audit.js, i.registerTask("vb-audit", ...)).
 * Needs the same Component Exchange URL as vb-build (same "Cannot load
 * oj-*" errors otherwise) — but audit also requires live network/auth
 * connectivity to a VB Studio backend/tenant service to fetch
 * "vb.services.catalog.json"; confirmed this is unresolved by hitting a real
 * "Backend fetch failed... status: 'ETIMEDOUT'" error with no known fix yet.
 * Do not assume audit works even with VB_BUILD_COMPONENT_EXCHANGE_URL set.
 */
export async function runAudit(repoRoot: string, appName?: string): Promise<CommandResult> {
  const args = ["grunt", "vb-audit", ...(appName ? [`--app=${appName}`] : []), ...componentExchangeArgs()];
  return withLogging("runAudit", { repoRoot, appName }, () =>
    runStreamed("npx", args, repoRoot, "runAudit")
  );
}
