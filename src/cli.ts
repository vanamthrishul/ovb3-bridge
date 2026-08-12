#!/usr/bin/env node
import { loadEnv } from "./lib/env.js";
loadEnv();

import fs from "node:fs/promises";

import { resolveRepoRoot, resolveAppName } from "./lib/vbcs-repo.js";
import * as artifacts from "./tools/artifacts.js";
import * as git from "./tools/git.js";
import * as build from "./tools/build.js";
import * as vbcsApi from "./tools/vbcs-api.js";
import { runInit } from "./cli-init.js";

/**
 * Thin CLI over the same tool functions the MCP server exposes — lets you
 * exercise artifact/git/build operations by hand without going through an
 * MCP host. Every action is already logged to stderr by the tool layer;
 * this just prints the return value to stdout.
 */

function usage(): never {
  console.log(`vbcs-toolkit <command> [args]

Commands:
  init                          Guided setup — link a VB Studio project or standalone VBCS instance
  list-repos
  list-apps <repo>
  read <repo> <path>
  write <repo> <path> <contentFile>
  list-artifacts <repo> <pattern>
  git-status <repo>
  git-commit <repo> <message> [file...]
  git-pull <repo> [remote] [branch]
  git-push <repo> [remote] [branch]
  run-build <repo> [appName]
  run-audit <repo> [appName]

  vbcs-list-apps [filter]                          Standalone VBCS instance (VBCS_BASE_URL)
  vbcs-lock-app <branchId>
  vbcs-unlock-app <branchId>
  vbcs-export-data <appName> <appVersion> <boName>

<repo> is an absolute path, a name under VBS_WORKSPACE_DIR, or "-" to use the VBCS_REPO_PATH default.
`);
  process.exit(1);
}

function repoArg(raw: string): string | undefined {
  return raw === "-" ? undefined : raw;
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (!command) usage();

  if (command === "init") {
    await runInit();
    return;
  }

  let result: unknown;

  switch (command) {
    case "list-repos":
      result = await artifacts.listRepos();
      break;
    case "list-apps":
      result = await artifacts.listApps(resolveRepoRoot(repoArg(args[0])));
      break;
    case "read":
      result = await artifacts.readArtifact(resolveRepoRoot(repoArg(args[0])), args[1]);
      break;
    case "write": {
      const content = await fs.readFile(args[2], "utf8");
      result = await artifacts.writeArtifact(resolveRepoRoot(repoArg(args[0])), args[1], content);
      break;
    }
    case "list-artifacts":
      result = await artifacts.listArtifacts(resolveRepoRoot(repoArg(args[0])), args[1]);
      break;
    case "git-status":
      result = await git.gitStatus(resolveRepoRoot(repoArg(args[0])));
      break;
    case "git-commit":
      result = await git.gitCommit(resolveRepoRoot(repoArg(args[0])), args[1], args.slice(2));
      break;
    case "git-pull":
      result = await git.gitPull(resolveRepoRoot(repoArg(args[0])), args[1], args[2]);
      break;
    case "git-push":
      result = await git.gitPush(resolveRepoRoot(repoArg(args[0])), args[1], args[2]);
      break;
    case "run-build": {
      const repoRoot = resolveRepoRoot(repoArg(args[0]));
      result = await build.runBuild(repoRoot, args[1] ?? resolveAppName(repoRoot, args[1]));
      break;
    }
    case "run-audit": {
      const repoRoot = resolveRepoRoot(repoArg(args[0]));
      result = await build.runAudit(repoRoot, args[1] ?? resolveAppName(repoRoot, args[1]));
      break;
    }
    case "vbcs-list-apps":
      result = await vbcsApi.listApplications({ filter: args[0] });
      break;
    case "vbcs-lock-app":
      result = await vbcsApi.lockApplication({ branchId: args[0] });
      break;
    case "vbcs-unlock-app":
      result = await vbcsApi.unlockApplication({ branchId: args[0] });
      break;
    case "vbcs-export-data":
      result = await vbcsApi.exportBusinessObjectData({ appName: args[0], appVersion: args[1], boName: args[2] });
      break;
    default:
      usage();
  }

  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
