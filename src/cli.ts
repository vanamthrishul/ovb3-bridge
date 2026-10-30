#!/usr/bin/env node
import { loadEnv } from "./lib/env.js";
loadEnv();

import fs from "node:fs/promises";

import { resolveRepoRoot, resolveAppName } from "./lib/vbcs-repo.js";
import * as artifacts from "./tools/artifacts.js";
import * as analysis from "./tools/analysis.js";
import * as git from "./tools/git.js";
import * as build from "./tools/build.js";
import * as vbcsApi from "./tools/vbcs-api.js";
import * as vbstudioApi from "./tools/vbstudio-api.js";
import { runDoctor } from "./tools/doctor.js";
import { runInit } from "./cli-init.js";

/**
 * Thin CLI over the same tool functions the MCP server exposes - lets you
 * exercise artifact/git/build operations by hand without going through an
 * MCP host. Every action is already logged to stderr by the tool layer;
 * this just prints the return value to stdout.
 */

function usage(exitCode = 1): never {
  console.log(`ovb3 <command> [args]

Setup
  init                                   Guided setup - link a VB Studio project or standalone VBCS instance
  doctor [--live]                        Check your install and tell me exactly what's missing (--live also tests the VBCS login)

VB Studio project (git-backed)
  list-repos
  list-apps <repo>
  read <repo> <path>
  write <repo> <path> <contentFile>
  list-artifacts <repo> <glob>           Find files by name
  search <repo> <text> [glob]            Search file content (add --regex / --ignore-case)
  audit-service-calls <repo> [endpoint]  Compare REST call parameters across apps
  git-status <repo>
  git-commit <repo> <message> [file...]
  git-pull <repo> [remote] [branch]
  git-push <repo> [remote] [branch]
  setup-build-tools <repo>               npm install the repo's Oracle build tools
  run-build <repo> [appName]
  run-audit <repo> [appName]

VB Studio CI (Builds REST API)
  ci-build <repo> <jobName> [paramsYamlFile]
  ci-status <repo> <jobName> <buildNumber>
  ci-params <repo> <jobName>

Standalone VBCS instance (VBCS_BASE_URL)
  vbcs-list-apps [filter]
  vbcs-lock-app <branchId>
  vbcs-unlock-app <branchId>
  vbcs-export-data <appName> <appVersion> [boName] [outputPath]   (omit boName for a ZIP of everything)
  vbcs-import-data <appName> <appVersion> <file> <append|replace> [boName]

<repo> is an absolute path, a name under VBS_WORKSPACE_DIR, or "-" to use the VBCS_REPO_PATH default.
Add --deployment to vbcs-export-data / vbcs-import-data to target the staging/live database.
`);
  process.exit(exitCode);
}

function repoArg(raw: string | undefined): string | undefined {
  return raw === "-" ? undefined : raw;
}

/** Pulls boolean flags out of args so positional parsing stays simple. */
function takeFlags(args: string[], flags: string[]): { rest: string[]; found: Set<string> } {
  const found = new Set<string>();
  const rest = args.filter((a) => {
    if (flags.includes(a)) {
      found.add(a);
      return false;
    }
    return true;
  });
  return { rest, found };
}

function need(value: string | undefined, name: string): string {
  if (!value) {
    console.error(`Missing <${name}>.\n`);
    usage();
  }
  return value;
}

async function main(): Promise<void> {
  const [command, ...rawArgs] = process.argv.slice(2);
  if (!command) usage();
  if (command === "--help" || command === "-h" || command === "help") usage(0);

  if (command === "init") {
    await runInit();
    return;
  }

  const { rest: args, found: flags } = takeFlags(rawArgs, ["--live", "--regex", "--ignore-case", "--deployment"]);
  const target = flags.has("--deployment") ? ("deployment" as const) : ("design" as const);

  let result: unknown;

  switch (command) {
    case "doctor":
      result = await runDoctor({ live: flags.has("--live") });
      break;
    case "list-repos":
      result = await artifacts.listRepos();
      break;
    case "list-apps":
      result = await artifacts.listApps(resolveRepoRoot(repoArg(args[0])));
      break;
    case "read":
      result = await artifacts.readArtifact(resolveRepoRoot(repoArg(args[0])), need(args[1], "path"));
      break;
    case "write": {
      const content = await fs.readFile(need(args[2], "contentFile"), "utf8");
      result = await artifacts.writeArtifact(resolveRepoRoot(repoArg(args[0])), need(args[1], "path"), content);
      break;
    }
    case "list-artifacts":
      result = await artifacts.listArtifacts(resolveRepoRoot(repoArg(args[0])), need(args[1], "glob"));
      break;
    case "search":
      result = await analysis.searchArtifacts(resolveRepoRoot(repoArg(args[0])), {
        query: need(args[1], "text"),
        glob: args[2],
        regex: flags.has("--regex"),
        ignoreCase: flags.has("--ignore-case"),
      });
      break;
    case "audit-service-calls":
      result = await analysis.auditServiceCalls(resolveRepoRoot(repoArg(args[0])), { endpoint: args[1] });
      break;
    case "git-status":
      result = await git.gitStatus(resolveRepoRoot(repoArg(args[0])));
      break;
    case "git-commit":
      result = await git.gitCommit(resolveRepoRoot(repoArg(args[0])), need(args[1], "message"), args.slice(2));
      break;
    case "git-pull":
      result = await git.gitPull(resolveRepoRoot(repoArg(args[0])), args[1], args[2]);
      break;
    case "git-push":
      result = await git.gitPush(resolveRepoRoot(repoArg(args[0])), args[1], args[2]);
      break;
    case "setup-build-tools":
      result = await build.setupBuildTools(resolveRepoRoot(repoArg(args[0])));
      break;
    case "run-build": {
      const repoRoot = resolveRepoRoot(repoArg(args[0]));
      result = await build.runBuild(repoRoot, resolveAppName(repoRoot, args[1]));
      break;
    }
    case "run-audit": {
      const repoRoot = resolveRepoRoot(repoArg(args[0]));
      result = await build.runAudit(repoRoot, resolveAppName(repoRoot, args[1]));
      break;
    }
    case "ci-build": {
      const paramsYaml = args[2] ? await fs.readFile(args[2], "utf8") : undefined;
      result = await vbstudioApi.triggerBuild({ repoRoot: resolveRepoRoot(repoArg(args[0])), jobName: need(args[1], "jobName"), paramsYaml });
      break;
    }
    case "ci-status":
      result = await vbstudioApi.getBuildStatus({
        repoRoot: resolveRepoRoot(repoArg(args[0])),
        jobName: need(args[1], "jobName"),
        buildNumber: Number(need(args[2], "buildNumber")),
      });
      break;
    case "ci-params":
      result = await vbstudioApi.getJobParams({ repoRoot: resolveRepoRoot(repoArg(args[0])), jobName: need(args[1], "jobName") });
      break;
    case "vbcs-list-apps":
      result = await vbcsApi.listApplications({ filter: args[0] });
      break;
    case "vbcs-lock-app":
      result = await vbcsApi.lockApplication({ branchId: need(args[0], "branchId") });
      break;
    case "vbcs-unlock-app":
      result = await vbcsApi.unlockApplication({ branchId: need(args[0], "branchId") });
      break;
    case "vbcs-export-data":
      result = await vbcsApi.exportBusinessObjectData({
        appName: need(args[0], "appName"),
        appVersion: need(args[1], "appVersion"),
        boName: args[2],
        outputPath: args[3],
        target,
      });
      break;
    case "vbcs-import-data": {
      const mode = need(args[3], "append|replace");
      if (mode !== "append" && mode !== "replace") {
        console.error(`Mode must be "append" or "replace" (got "${mode}") - replace overwrites existing data.\n`);
        usage();
      }
      result = await vbcsApi.importBusinessObjectData({
        appName: need(args[0], "appName"),
        appVersion: need(args[1], "appVersion"),
        filePath: need(args[2], "file"),
        mode,
        boName: args[4],
        target,
      });
      break;
    }
    default:
      console.error(`Unknown command "${command}".\n`);
      usage();
  }

  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
