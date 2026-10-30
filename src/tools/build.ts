import { spawn, execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { logAction, logError, withLogging } from "../lib/logger.js";
import { redactString } from "../lib/redact.js";

export interface CommandResult {
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
  /** Plain-language next step when the failure matches a known, documented cause. */
  hint?: string;
}

const DEFAULT_BUILD_TIMEOUT_MS = 15 * 60_000;
const MAX_CAPTURE_CHARS = 200_000;

export class BuildToolError extends Error {}

function timeoutMs(): number {
  const raw = Number(process.env.OVB3_BUILD_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_BUILD_TIMEOUT_MS;
}

/** Keeps the head and tail of very long output so a chatty build can't blow up a tool result. */
function capture(existing: string, chunk: string): string {
  const next = existing + chunk;
  if (next.length <= MAX_CAPTURE_CHARS) return next;
  const half = Math.floor(MAX_CAPTURE_CHARS / 2);
  return `${next.slice(0, half)}\n…[output truncated]…\n${next.slice(-half)}`;
}

/** Kills a child and everything it spawned. TaskStop-style kills alone leave grunt/node orphans on Windows. */
function killTree(pid: number | undefined): void {
  if (!pid) return;
  if (process.platform === "win32") {
    execFile("taskkill", ["/pid", String(pid), "/T", "/F"], () => undefined);
  } else {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        /* already gone */
      }
    }
  }
}

/**
 * Runs a command with NO shell (argv passed straight to the process, so user-
 * supplied values can never be interpreted as shell syntax), streaming each
 * output line through the logger as it happens so long builds stay visible
 * while they run, with a hard timeout that kills the whole process tree.
 */
function runStreamed(
  command: string,
  args: string[],
  cwd: string,
  action: string,
  opts: { shell?: boolean } = {}
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const display = redactString([command, ...args].join(" "));
    const child = spawn(command, args, {
      cwd,
      shell: opts.shell ?? false,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      logError(`${action}: timed out`, { afterMs: timeoutMs() });
      killTree(child.pid);
    }, timeoutMs());

    child.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stdout = capture(stdout, text);
      for (const line of text.split(/\r?\n/).filter(Boolean)) logAction(`${action}: stdout`, { line });
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderr = capture(stderr, text);
      for (const line of text.split(/\r?\n/).filter(Boolean)) logError(`${action}: stderr`, { line });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      const result: CommandResult = { command: display, exitCode, stdout: redactString(stdout), stderr: redactString(stderr) };
      if (timedOut) result.timedOut = true;
      const hint = diagnose(`${stdout}\n${stderr}`, timedOut);
      if (hint && exitCode !== 0) result.hint = hint;
      resolve(result);
    });
  });
}

/** Maps the failure signatures confirmed against real vb-build / vb-audit runs to a next step. */
export function diagnose(output: string, timedOut = false): string | undefined {
  if (/Missing mandatory component exchange URL/i.test(output) || /ComponentExchangeCCAFinder: Cannot load/i.test(output)) {
    return (
      "This app uses shared/custom web components, so Oracle's task needs your org's Component Exchange URL. " +
      "Set VB_BUILD_COMPONENT_EXCHANGE_URL (plugin config: component_exchange_url). In VB Studio it's shown in " +
      "Tenant Settings → Component Exchange; private exchanges look like " +
      "https://<vbs-host>/<org>/s/<org>_<project>/compcatalog/0.2.0. If your exchange needs credentials, also set " +
      "VB_BUILD_CE_USERNAME + VB_BUILD_CE_PASSWORD (or VB_BUILD_CE_ACCESS_TOKEN)."
    );
  }
  if (/Backend fetch failed|ETIMEDOUT|Cannot read "vb\.services\.catalog\.json"/i.test(output) || timedOut) {
    return (
      "vb-audit needs network access to a live Visual Builder backend to fetch vb.services.catalog.json (or the " +
      "task stalled). Check that this machine can reach your Visual Builder instance (VPN/proxy), then retry. " +
      "vb-build does not have this requirement."
    );
  }
  if (/Cannot find module|MODULE_NOT_FOUND/i.test(output)) {
    return "Build dependencies look incomplete - run setup_build_tools for this repo (npm install), then retry.";
  }
  return undefined;
}

const SAFE_APP = /^[A-Za-z0-9_.-]+$/;
const SAFE_URL = /^https?:\/\/[A-Za-z0-9._~:/?=%@+-]+$/;

/** Rejects anything that isn't a plain app name - it ends up as a CLI argument. */
export function assertSafeAppName(appName: string): string {
  if (!SAFE_APP.test(appName)) {
    throw new BuildToolError(`Invalid app name "${appName}" - expected letters, digits, '.', '_' or '-'.`);
  }
  return appName;
}

/**
 * Component Exchange flags shared by vb-build and vb-audit. `url:ce` is only
 * needed when an app references Web Components, per Oracle's docs - but that's
 * the normal case. Org-specific, so never hardcoded: read from env and omitted
 * entirely when unset, so behaviour degrades to Oracle's own clear error
 * (which diagnose() then explains) rather than us guessing a URL.
 */
export function componentExchangeArgs(env: NodeJS.ProcessEnv = process.env): string[] {
  const args: string[] = [];
  const url = env.VB_BUILD_COMPONENT_EXCHANGE_URL;
  if (url) {
    if (!SAFE_URL.test(url)) {
      throw new BuildToolError(
        "VB_BUILD_COMPONENT_EXCHANGE_URL doesn't look like a plain http(s) URL (unexpected characters) - check the value."
      );
    }
    args.push(`--url:ce=${url}`);
  }
  if (env.VB_BUILD_CE_ACCESS_TOKEN) {
    args.push(`--accessToken:ce=${env.VB_BUILD_CE_ACCESS_TOKEN}`);
  } else if (env.VB_BUILD_CE_USERNAME && env.VB_BUILD_CE_PASSWORD) {
    args.push(`--username:ce=${env.VB_BUILD_CE_USERNAME}`, `--password:ce=${env.VB_BUILD_CE_PASSWORD}`);
  }
  return args;
}

/** Locates grunt-cli's entry script inside the repo checkout, or explains how to get it. */
export function findGruntBin(repoRoot: string): string {
  const candidates = [
    path.join(repoRoot, "node_modules", "grunt-cli", "bin", "grunt"),
    path.join(repoRoot, "node_modules", "grunt", "bin", "grunt"),
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new BuildToolError(
      `Build tools aren't installed in ${repoRoot} (no node_modules/grunt-cli). ` +
        `Run the setup_build_tools tool (or 'npm install' in that repo) first - VB Studio projects pin ` +
        `@oracle/grunt-vb-build and @oracle/grunt-vb-audit in their own package.json, so this needs no extra config.`
    );
  }
  return found;
}

async function runGrunt(task: "vb-build" | "vb-audit", repoRoot: string, appName?: string): Promise<CommandResult> {
  const action = task === "vb-build" ? "runBuild" : "runAudit";
  return withLogging(action, { repoRoot, appName }, async () => {
    const gruntBin = findGruntBin(repoRoot);
    const args = [gruntBin, task, ...(appName ? [`--app=${assertSafeAppName(appName)}`] : []), ...componentExchangeArgs()];
    return runStreamed(process.execPath, args, repoRoot, action);
  });
}

/**
 * Runs Oracle's grunt-vb-build task (confirmed against the installed package:
 * grunt.registerTask('vb-build', ...); --app=<name> targets one app).
 */
export async function runBuild(repoRoot: string, appName?: string): Promise<CommandResult> {
  return runGrunt("vb-build", repoRoot, appName);
}

/**
 * Runs Oracle's grunt-vb-audit task (registerTask("vb-audit", ...)). Beyond
 * the Component Exchange URL it needs live network access to a Visual Builder
 * backend to fetch vb.services.catalog.json - see diagnose().
 */
export async function runAudit(repoRoot: string, appName?: string): Promise<CommandResult> {
  return runGrunt("vb-audit", repoRoot, appName);
}

/**
 * Installs the repo's own build dependencies (`npm install`). VB Studio
 * projects pin the Oracle CDN tarballs for grunt-vb-build / grunt-vb-audit in
 * their package.json, so no registry config is needed. The command is a fixed
 * string (no user input), so running it through the shell is safe - and
 * required on Windows, where npm is a .cmd shim.
 */
export async function setupBuildTools(repoRoot: string): Promise<CommandResult> {
  return withLogging("setupBuildTools", { repoRoot }, async () => {
    if (!fs.existsSync(path.join(repoRoot, "package.json"))) {
      throw new BuildToolError(`No package.json in ${repoRoot} - this doesn't look like a VB Studio project checkout.`);
    }
    return runStreamed("npm", ["install", "--no-fund", "--no-audit"], repoRoot, "setupBuildTools", { shell: true });
  });
}
