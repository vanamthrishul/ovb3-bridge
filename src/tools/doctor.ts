import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { withLogging } from "../lib/logger.js";
import { resolveEnvFile } from "../lib/env.js";
import { listApps, listRepos, resolveWorkspaceDir } from "../lib/vbcs-repo.js";
import { deriveBuildsBase } from "./vbstudio-api.js";
import { listApplications } from "./vbcs-api.js";

const execFileAsync = promisify(execFile);

export type CheckStatus = "ok" | "warn" | "fail" | "skip";

export interface Check {
  name: string;
  status: CheckStatus;
  detail: string;
  /** What to do about it, when status isn't ok. */
  fix?: string;
}

export interface DoctorReport {
  summary: { ok: number; warn: number; fail: number; skip: number };
  ready: { vbStudioGit: boolean; buildAndAudit: boolean; standaloneVbcs: boolean; vbStudioCi: boolean };
  checks: Check[];
}

const set = (name: string) => Boolean(process.env[name]);

/**
 * One-shot environment diagnosis for new users: reports what's configured,
 * what's missing, and the exact fix — never printing a secret value (only
 * whether each is set). `live: true` additionally makes a real, read-only
 * call to your standalone VBCS instance to prove the credentials work.
 */
export async function runDoctor(params: { repoRoot?: string; live?: boolean } = {}): Promise<DoctorReport> {
  return withLogging("doctor", { live: params.live }, async () => {
    const checks: Check[] = [];
    const add = (c: Check) => checks.push(c);

    // Runtime
    const major = Number(process.versions.node.split(".")[0]);
    add(
      major >= 20
        ? { name: "Node.js", status: "ok", detail: `v${process.versions.node}` }
        : { name: "Node.js", status: "fail", detail: `v${process.versions.node}`, fix: "Install Node.js 20 or newer (https://nodejs.org)." }
    );
    try {
      const { stdout } = await execFileAsync("git", ["--version"]);
      add({ name: "git", status: "ok", detail: stdout.trim() });
    } catch {
      add({ name: "git", status: "fail", detail: "not found on PATH", fix: "Install git (https://git-scm.com) and make sure it's on PATH." });
    }
    add({ name: "Config file", status: "ok", detail: `${resolveEnvFile()}${fs.existsSync(resolveEnvFile()) ? "" : " (not created yet — env vars / plugin config still apply)"}` });

    // Workspace + repos
    let repos: string[] = [];
    try {
      const workspace = resolveWorkspaceDir();
      if (!workspace) {
        add({ name: "VBS workspace", status: "warn", detail: "VBS_WORKSPACE_DIR not set", fix: "Set VBS_WORKSPACE_DIR to a folder for your repo checkouts (run `ovb3 init` or /link)." });
      } else {
        repos = listRepos();
        add({ name: "VBS workspace", status: "ok", detail: `${workspace} — ${repos.length} repo checkout(s): ${repos.join(", ") || "none yet"}` });
      }
    } catch (err) {
      add({ name: "VBS workspace", status: "fail", detail: (err as Error).message, fix: "Create that folder or point VBS_WORKSPACE_DIR at an existing one." });
    }

    // Git credentials
    const gitCreds = set("VBSTUDIO_GIT_USERNAME") && set("VBSTUDIO_GIT_TOKEN");
    add(
      gitCreds
        ? { name: "Git credentials", status: "ok", detail: "VBSTUDIO_GIT_USERNAME / VBSTUDIO_GIT_TOKEN set (sent as a scoped HTTP header, never put in URLs or logs)" }
        : {
            name: "Git credentials",
            status: "warn",
            detail: "VBSTUDIO_GIT_USERNAME / VBSTUDIO_GIT_TOKEN not set",
            fix: "Needed to clone/pull/push over HTTPS non-interactively. Create a personal access token in VB Studio and set both. (Or cache credentials once in a normal terminal.)",
          }
    );

    // Build tools, per repo
    const targets = params.repoRoot ? [params.repoRoot] : repos.map((r) => path.join(resolveWorkspaceDir() ?? "", r));
    let buildReady = false;
    for (const repoRoot of targets) {
      const name = path.basename(repoRoot);
      const hasGrunt = fs.existsSync(path.join(repoRoot, "node_modules", "grunt-cli", "bin", "grunt"));
      const hasBuild = fs.existsSync(path.join(repoRoot, "node_modules", "@oracle", "grunt-vb-build"));
      const hasAudit = fs.existsSync(path.join(repoRoot, "node_modules", "@oracle", "grunt-vb-audit"));
      if (hasGrunt && hasBuild && hasAudit) buildReady = true;
      add(
        hasGrunt && hasBuild && hasAudit
          ? { name: `Build tools (${name})`, status: "ok", detail: "grunt-cli, grunt-vb-build, grunt-vb-audit installed" }
          : {
              name: `Build tools (${name})`,
              status: "warn",
              detail: "not installed in this checkout",
              fix: "Run the setup_build_tools tool (or `npm install` in the repo). Optional unless you want run_build / run_audit.",
            }
      );
      const apps = listApps(repoRoot);
      if (apps.length > 0) add({ name: `Apps (${name})`, status: "ok", detail: apps.join(", ") });
    }
    add(
      set("VB_BUILD_COMPONENT_EXCHANGE_URL")
        ? { name: "Component Exchange URL", status: "ok", detail: "set" }
        : {
            name: "Component Exchange URL",
            status: "warn",
            detail: "VB_BUILD_COMPONENT_EXCHANGE_URL not set",
            fix: "Required by vb-build/vb-audit for apps that use web components (most do). Find it in VB Studio → Tenant Settings → Component Exchange.",
          }
    );

    // VB Studio CI API
    const ciUser = set("VBSTUDIO_API_TOKEN") || set("VBSTUDIO_GIT_TOKEN") || (set("VBSTUDIO_API_USERNAME") && set("VBSTUDIO_API_PASSWORD"));
    let ciBase = "";
    try {
      ciBase = set("VBSTUDIO_API_BASE_URL") ? process.env.VBSTUDIO_API_BASE_URL! : process.env.VBSTUDIO_GIT_REMOTE_URL ? deriveBuildsBase(process.env.VBSTUDIO_GIT_REMOTE_URL) : "";
    } catch {
      /* reported below */
    }
    add(
      ciUser && ciBase
        ? { name: "VB Studio CI API", status: "ok", detail: `credentials set; base ${ciBase}` }
        : { name: "VB Studio CI API", status: "skip", detail: "optional — needed only for vbstudio_trigger_build / status / params", fix: "Set VBSTUDIO_API_TOKEN (or API username/password) and VBSTUDIO_API_BASE_URL or VBSTUDIO_GIT_REMOTE_URL." }
    );

    // Standalone VBCS
    const vbcsConfigured = set("VBCS_BASE_URL") && set("VBCS_IDCS_USERNAME") && set("VBCS_IDCS_PASSWORD");
    if (!vbcsConfigured) {
      add({ name: "Standalone VBCS", status: "skip", detail: "optional — VBCS_BASE_URL / VBCS_IDCS_USERNAME / VBCS_IDCS_PASSWORD not all set", fix: "Only needed for VBCS instances without a VB Studio project (run /link)." });
    } else if (params.live) {
      try {
        const apps = (await listApplications()) as { totalProjectCount?: number };
        add({ name: "Standalone VBCS", status: "ok", detail: `authenticated; instance reports ${apps.totalProjectCount ?? "?"} project(s)` });
      } catch (err) {
        add({ name: "Standalone VBCS", status: "fail", detail: (err as Error).message.split("\n")[0].slice(0, 300), fix: "Check VBCS_BASE_URL (bare host, no /ic/builder) and your IDCS username/password." });
      }
    } else {
      add({ name: "Standalone VBCS", status: "ok", detail: "configured (run doctor with live=true to test the login)" });
    }

    const summary = { ok: 0, warn: 0, fail: 0, skip: 0 };
    for (const c of checks) summary[c.status]++;
    return {
      summary,
      ready: {
        vbStudioGit: repos.length > 0 && gitCreds,
        buildAndAudit: buildReady && set("VB_BUILD_COMPONENT_EXCHANGE_URL"),
        standaloneVbcs: vbcsConfigured,
        vbStudioCi: Boolean(ciUser && ciBase),
      },
      checks,
    };
  });
}
