import { loadEnv } from "./lib/env.js";
loadEnv();

import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";

import { resolveRepoRoot, resolveAppName } from "./lib/vbcs-repo.js";
import { logAction, logError } from "./lib/logger.js";
import * as artifacts from "./tools/artifacts.js";
import * as git from "./tools/git.js";
import * as build from "./tools/build.js";
import * as vbstudioApi from "./tools/vbstudio-api.js";
import * as vbcsApi from "./tools/vbcs-api.js";

const server = new McpServer({ name: "ovb3-bridge", version: "0.1.0" });

const repoParam = z
  .string()
  .optional()
  .describe(
    "Repo checkout to target: absolute path, or a repo name under VBS_WORKSPACE_DIR, or omit to use VBCS_REPO_PATH default. Use list_repos to see what's available on this instance."
  );
const appParam = z
  .string()
  .optional()
  .describe("VBCS web app name (webApps/<name>) within the repo, or omit to use VBCS_APP_NAME default. Use list_apps to see what's available in a repo.");

/** Wraps a handler so thrown errors become a tool error result instead of crashing the server. */
function toolHandler<T>(fn: (input: T) => Promise<unknown>) {
  return async (input: T) => {
    try {
      const result = await fn(input);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logError("tool call failed", { error: message });
      return { content: [{ type: "text" as const, text: message }], isError: true };
    }
  };
}

// --- Discovery ---------------------------------------------------------

server.registerTool(
  "list_repos",
  {
    description: "List local VB Studio project repo checkouts discoverable under VBS_WORKSPACE_DIR.",
    inputSchema: z.object({}),
  },
  toolHandler(async () => artifacts.listRepos())
);

server.registerTool(
  "list_apps",
  {
    description: "List VBCS web app names (webApps/<name>) present in a repo checkout.",
    inputSchema: z.object({ repo: repoParam }),
  },
  toolHandler(async ({ repo }) => artifacts.listApps(resolveRepoRoot(repo)))
);

// --- Artifacts -----------------------------------------------------------

server.registerTool(
  "read_artifact",
  {
    description: "Read a VBCS artifact file (page/flow/chain/service JSON, etc) by repo-relative path.",
    inputSchema: z.object({ repo: repoParam, path: z.string().describe("Repo-relative path, e.g. webApps/myApp/flows/main/main-flow.json") }),
  },
  toolHandler(async ({ repo, path }) => artifacts.readArtifact(resolveRepoRoot(repo), path))
);

server.registerTool(
  "write_artifact",
  {
    description: "Write a VBCS artifact file by repo-relative path. Refuses invalid JSON for .json paths.",
    inputSchema: z.object({
      repo: repoParam,
      path: z.string().describe("Repo-relative path"),
      content: z.string().describe("Full file content to write"),
    }),
  },
  toolHandler(async ({ repo, path, content }) => artifacts.writeArtifact(resolveRepoRoot(repo), path, content))
);

server.registerTool(
  "list_artifacts",
  {
    description: "List artifact files in a repo matching a glob pattern, e.g. 'webApps/*/flows/**/*.json'.",
    inputSchema: z.object({ repo: repoParam, pattern: z.string() }),
  },
  toolHandler(async ({ repo, pattern }) => artifacts.listArtifacts(resolveRepoRoot(repo), pattern))
);

// --- Git -------------------------------------------------------------------

server.registerTool(
  "git_status",
  { description: "Show git status for a repo checkout.", inputSchema: z.object({ repo: repoParam }) },
  toolHandler(async ({ repo }) => git.gitStatus(resolveRepoRoot(repo)))
);

server.registerTool(
  "git_commit",
  {
    description: "Stage and commit changes in a repo checkout.",
    inputSchema: z.object({
      repo: repoParam,
      message: z.string(),
      files: z.array(z.string()).optional().describe("Specific repo-relative files to stage; omit to stage all changes"),
    }),
  },
  toolHandler(async ({ repo, message, files }) => git.gitCommit(resolveRepoRoot(repo), message, files))
);

server.registerTool(
  "git_pull",
  {
    description: "Pull from the repo's remote.",
    inputSchema: z.object({ repo: repoParam, remote: z.string().optional(), branch: z.string().optional() }),
  },
  toolHandler(async ({ repo, remote, branch }) => git.gitPull(resolveRepoRoot(repo), remote, branch))
);

server.registerTool(
  "git_push",
  {
    description: "Push to the repo's remote.",
    inputSchema: z.object({ repo: repoParam, remote: z.string().optional(), branch: z.string().optional() }),
  },
  toolHandler(async ({ repo, remote, branch }) => git.gitPush(resolveRepoRoot(repo), remote, branch))
);

server.registerTool(
  "git_clone",
  {
    description: "Clone a git remote into VBS_WORKSPACE_DIR so it's discoverable by list_repos. Used by /link's VBS setup flow.",
    inputSchema: z.object({
      remoteUrl: z.string().describe("Git remote URL to clone"),
      destName: z.string().describe("Destination folder name under VBS_WORKSPACE_DIR"),
    }),
  },
  toolHandler(async ({ remoteUrl, destName }) => git.gitClone(remoteUrl, destName))
);

// --- Build/audit -------------------------------------------------------

server.registerTool(
  "run_build",
  {
    description: "Run grunt-vb-build for a VBCS app. Streams output live to server logs as it runs.",
    inputSchema: z.object({ repo: repoParam, appName: appParam }),
  },
  toolHandler(async ({ repo, appName }) => {
    const repoRoot = resolveRepoRoot(repo);
    return build.runBuild(repoRoot, appName ?? resolveAppName(repoRoot, appName));
  })
);

server.registerTool(
  "run_audit",
  {
    description: "Run grunt-vb-audit for a VBCS app. Streams output live to server logs as it runs.",
    inputSchema: z.object({ repo: repoParam, appName: appParam }),
  },
  toolHandler(async ({ repo, appName }) => {
    const repoRoot = resolveRepoRoot(repo);
    return build.runAudit(repoRoot, appName ?? resolveAppName(repoRoot, appName));
  })
);

// --- Standalone VBCS REST API (no VB Studio project / git remote) ---------

server.registerTool(
  "vbcs_list_applications",
  {
    description: "List applications on a standalone VBCS instance via its REST API (VBCS_BASE_URL). For VBCS apps not backed by a VB Studio git repo.",
    inputSchema: z.object({ filter: z.string().optional().describe("Optional query filter, passed through as-is") }),
  },
  toolHandler(async ({ filter }) => vbcsApi.listApplications({ filter }))
);

server.registerTool(
  "vbcs_lock_application",
  {
    description: "Lock a live application on a standalone VBCS instance.",
    inputSchema: z.object({ branchId: z.string() }),
  },
  toolHandler(async ({ branchId }) => vbcsApi.lockApplication({ branchId }))
);

server.registerTool(
  "vbcs_unlock_application",
  {
    description: "Unlock a live application on a standalone VBCS instance.",
    inputSchema: z.object({ branchId: z.string() }),
  },
  toolHandler(async ({ branchId }) => vbcsApi.unlockApplication({ branchId }))
);

server.registerTool(
  "vbcs_export_bo_data",
  {
    description: "Export a business object's data records from a standalone VBCS instance.",
    inputSchema: z.object({ appName: z.string(), appVersion: z.string(), boName: z.string() }),
  },
  toolHandler(async ({ appName, appVersion, boName }) => vbcsApi.exportBusinessObjectData({ appName, appVersion, boName }))
);

// --- VB Studio / VBCS REST API (stubs — blocked on live instance access) ---

server.registerTool(
  "vbstudio_list_projects",
  { description: "[NOT IMPLEMENTED] List VB Studio projects on the instance. Blocked until a live dev instance is confirmed.", inputSchema: z.object({}) },
  toolHandler(async () => vbstudioApi.listProjects())
);

server.registerTool(
  "vbstudio_trigger_build",
  {
    description: "[NOT IMPLEMENTED] Trigger a CI/CD build via the VB Studio REST API. Blocked until a live dev instance is confirmed.",
    inputSchema: z.object({ projectKey: z.string(), appName: z.string(), environment: z.string().optional() }),
  },
  toolHandler(async (params) => vbstudioApi.triggerBuild(params))
);

server.registerTool(
  "vbstudio_trigger_deploy",
  {
    description: "[NOT IMPLEMENTED] Trigger a deploy via the VB Studio REST API. Blocked until a live dev instance is confirmed.",
    inputSchema: z.object({ projectKey: z.string(), appName: z.string(), environment: z.string() }),
  },
  toolHandler(async (params) => vbstudioApi.triggerDeploy(params))
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logAction("ovb3-bridge MCP server started");
}

main().catch((err) => {
  logError("fatal startup error", { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
