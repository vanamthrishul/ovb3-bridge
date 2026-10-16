#!/usr/bin/env node
import { loadEnv } from "./lib/env.js";
loadEnv();

import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";

import { resolveRepoRoot, resolveAppName } from "./lib/vbcs-repo.js";
import { logAction, logError } from "./lib/logger.js";
import { redactString } from "./lib/redact.js";
import * as artifacts from "./tools/artifacts.js";
import * as analysis from "./tools/analysis.js";
import * as git from "./tools/git.js";
import * as build from "./tools/build.js";
import * as vbstudioApi from "./tools/vbstudio-api.js";
import * as vbcsApi from "./tools/vbcs-api.js";
import { runDoctor } from "./tools/doctor.js";

const server = new McpServer({ name: "ovb3-bridge", version: "0.3.2" });

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

/** Wraps a handler so thrown errors become a tool error result (secrets redacted) instead of crashing the server. */
function toolHandler<T>(fn: (input: T) => Promise<unknown>) {
  return async (input: T) => {
    try {
      const result = await fn(input);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      const message = redactString(err instanceof Error ? err.message : String(err));
      logError("tool call failed", { error: message });
      return { content: [{ type: "text" as const, text: message }], isError: true };
    }
  };
}

/** Hints hosts use to skip approval prompts for safe tools and warn on risky ones. */
const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false } as const;
const REMOTE_WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: true } as const;
const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true, openWorldHint: true } as const;

// --- Setup & diagnosis ---------------------------------------------------

server.registerTool(
  "doctor",
  {
    description:
      "Diagnose this install: Node/git, workspace + repos, git credentials, build tools, Component Exchange URL, and optional services. Reports what's missing and the exact fix; never prints secrets. Run this first when something doesn't work. Set live=true to also test the standalone-VBCS login.",
    inputSchema: z.object({ repo: repoParam, live: z.boolean().optional().describe("Also make a real read-only call to the standalone VBCS instance") }),
    annotations: READ,
  },
  toolHandler(async ({ repo, live }) => runDoctor({ repoRoot: repo ? resolveRepoRoot(repo) : undefined, live }))
);

// --- Discovery ---------------------------------------------------------

server.registerTool(
  "list_repos",
  {
    description: "List local VB Studio project repo checkouts discoverable under VBS_WORKSPACE_DIR.",
    inputSchema: z.object({}),
    annotations: READ,
  },
  toolHandler(async () => artifacts.listRepos())
);

server.registerTool(
  "list_apps",
  {
    description: "List VBCS web app names (webApps/<name>) present in a repo checkout.",
    inputSchema: z.object({ repo: repoParam }),
    annotations: READ,
  },
  toolHandler(async ({ repo }) => artifacts.listApps(resolveRepoRoot(repo)))
);

// --- Artifacts -----------------------------------------------------------

server.registerTool(
  "read_artifact",
  {
    description: "Read a VBCS artifact file (page/flow/chain/service JSON, etc) by repo-relative path.",
    inputSchema: z.object({ repo: repoParam, path: z.string().describe("Repo-relative path, e.g. webApps/myApp/flows/main/main-flow.json") }),
    annotations: READ,
  },
  toolHandler(async ({ repo, path }) => artifacts.readArtifact(resolveRepoRoot(repo), path))
);

server.registerTool(
  "write_artifact",
  {
    description: "Write a VBCS artifact file by repo-relative path. Refuses invalid JSON for .json paths and any path outside the repo.",
    inputSchema: z.object({
      repo: repoParam,
      path: z.string().describe("Repo-relative path"),
      content: z.string().describe("Full file content to write"),
    }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  },
  toolHandler(async ({ repo, path, content }) => artifacts.writeArtifact(resolveRepoRoot(repo), path, content))
);

server.registerTool(
  "list_artifacts",
  {
    description: "List artifact files in a repo matching a glob pattern (file names only), e.g. 'webApps/*/flows/**/*.json'. To search file CONTENT use search_artifacts.",
    inputSchema: z.object({ repo: repoParam, pattern: z.string() }),
    annotations: READ,
  },
  toolHandler(async ({ repo, pattern }) => artifacts.listArtifacts(resolveRepoRoot(repo), pattern))
);

server.registerTool(
  "search_artifacts",
  {
    description:
      "Search artifact file CONTENT across a repo (grep). Substring by default, or a regex. Defaults to webApps/services/settings .js/.json/.html/.css/.md files; narrow with glob.",
    inputSchema: z.object({
      repo: repoParam,
      query: z.string().describe("Text (or regex when regex=true) to find"),
      glob: z.string().optional().describe("Limit to files matching this glob, e.g. 'webApps/*/flows/**/*.js'"),
      regex: z.boolean().optional(),
      ignoreCase: z.boolean().optional(),
      maxResults: z.number().int().positive().optional().describe("Default 200, max 2000"),
    }),
    annotations: READ,
  },
  toolHandler(async ({ repo, ...rest }) => analysis.searchArtifacts(resolveRepoRoot(repo), rest))
);

server.registerTool(
  "audit_service_calls",
  {
    description:
      "Cross-app audit of REST service usage: finds every Actions.callRest call in the repo's action-chain JS, and for each service endpoint compares which parameter keys (uriParams/body/headers…) each app passes, flagging keys some apps send that others omit. Compares key sets, not values. Use it to check a shared service connection is mapped consistently across apps.",
    inputSchema: z.object({
      repo: repoParam,
      endpoint: z.string().optional().describe("Only this endpoint, e.g. 'ServiceName/OperationId'"),
      apps: z.array(z.string()).optional().describe("Only these apps (default: all apps in the repo)"),
      includeCalls: z.boolean().optional().describe("Also return every individual call site with file + line"),
    }),
    annotations: READ,
  },
  toolHandler(async ({ repo, ...rest }) => analysis.auditServiceCalls(resolveRepoRoot(repo), rest))
);

// --- Git -------------------------------------------------------------------

server.registerTool(
  "git_status",
  { description: "Show git status for a repo checkout.", inputSchema: z.object({ repo: repoParam }), annotations: READ },
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
    annotations: WRITE,
  },
  toolHandler(async ({ repo, message, files }) => git.gitCommit(resolveRepoRoot(repo), message, files))
);

server.registerTool(
  "git_pull",
  {
    description: "Pull from the repo's remote. Authenticates with VBSTUDIO_GIT_USERNAME/TOKEN when set; never hangs on a hidden prompt.",
    inputSchema: z.object({ repo: repoParam, remote: z.string().optional(), branch: z.string().optional() }),
    annotations: REMOTE_WRITE,
  },
  toolHandler(async ({ repo, remote, branch }) => git.gitPull(resolveRepoRoot(repo), remote, branch))
);

server.registerTool(
  "git_push",
  {
    description: "Push to the repo's remote. Authenticates with VBSTUDIO_GIT_USERNAME/TOKEN when set; never hangs on a hidden prompt.",
    inputSchema: z.object({ repo: repoParam, remote: z.string().optional(), branch: z.string().optional() }),
    annotations: REMOTE_WRITE,
  },
  toolHandler(async ({ repo, remote, branch }) => git.gitPush(resolveRepoRoot(repo), remote, branch))
);

server.registerTool(
  "git_clone",
  {
    description: "Clone a git remote into VBS_WORKSPACE_DIR so it's discoverable by list_repos. Used by /link's VBS setup flow. Do not embed credentials in remoteUrl — set VBSTUDIO_GIT_USERNAME/TOKEN instead.",
    inputSchema: z.object({
      remoteUrl: z.string().describe("Git remote URL to clone"),
      destName: z.string().describe("Destination folder name under VBS_WORKSPACE_DIR"),
    }),
    annotations: REMOTE_WRITE,
  },
  toolHandler(async ({ remoteUrl, destName }) => git.gitClone(remoteUrl, destName))
);

// --- Build/audit -------------------------------------------------------

server.registerTool(
  "setup_build_tools",
  {
    description:
      "Install a repo's build dependencies (`npm install`) so run_build / run_audit work. VB Studio projects pin Oracle's grunt-vb-build/grunt-vb-audit in their own package.json, so no extra config is needed. Can take several minutes.",
    inputSchema: z.object({ repo: repoParam }),
    annotations: WRITE,
  },
  toolHandler(async ({ repo }) => build.setupBuildTools(resolveRepoRoot(repo)))
);

server.registerTool(
  "run_build",
  {
    description:
      "Run grunt-vb-build for a VBCS app. Streams output live to server logs. Needs setup_build_tools first, and VB_BUILD_COMPONENT_EXCHANGE_URL for apps using web components; failures include a plain-language hint.",
    inputSchema: z.object({ repo: repoParam, appName: appParam }),
    annotations: WRITE,
  },
  toolHandler(async ({ repo, appName }) => {
    const repoRoot = resolveRepoRoot(repo);
    return build.runBuild(repoRoot, resolveAppName(repoRoot, appName));
  })
);

server.registerTool(
  "run_audit",
  {
    description:
      "Run grunt-vb-audit for a VBCS app. Streams output live to server logs. Needs the same setup as run_build, plus network access to a live Visual Builder backend; failures include a plain-language hint.",
    inputSchema: z.object({ repo: repoParam, appName: appParam }),
    annotations: READ,
  },
  toolHandler(async ({ repo, appName }) => {
    const repoRoot = resolveRepoRoot(repo);
    return build.runAudit(repoRoot, resolveAppName(repoRoot, appName));
  })
);

// --- Standalone VBCS REST API (no VB Studio project / git remote) ---------

server.registerTool(
  "vbcs_list_applications",
  {
    description: "List applications on a standalone VBCS instance via its REST API (VBCS_BASE_URL). For VBCS apps not backed by a VB Studio git repo.",
    inputSchema: z.object({ filter: z.string().optional().describe("Optional query filter, passed through as-is") }),
    annotations: { ...READ, openWorldHint: true },
  },
  toolHandler(async ({ filter }) => vbcsApi.listApplications({ filter }))
);

server.registerTool(
  "vbcs_lock_application",
  {
    description: "Lock a live application on a standalone VBCS instance (do this before exporting/importing its data).",
    inputSchema: z.object({ branchId: z.string() }),
    annotations: { ...REMOTE_WRITE, idempotentHint: true },
  },
  toolHandler(async ({ branchId }) => vbcsApi.lockApplication({ branchId }))
);

server.registerTool(
  "vbcs_unlock_application",
  {
    description: "Unlock a locked live application on a standalone VBCS instance.",
    inputSchema: z.object({ branchId: z.string() }),
    annotations: { ...REMOTE_WRITE, idempotentHint: true },
  },
  toolHandler(async ({ branchId }) => vbcsApi.unlockApplication({ branchId }))
);

const targetParam = z.enum(["design", "deployment"]).optional().describe("'design' (default) = design-time data; 'deployment' = staging/live database");

server.registerTool(
  "vbcs_export_bo_data",
  {
    description:
      "Export business-object data from a standalone VBCS instance: one object as CSV (returned inline unless outputPath is given), or omit boName to export every object as a ZIP of CSVs (always saved to disk; path returned).",
    inputSchema: z.object({
      appName: z.string(),
      appVersion: z.string(),
      boName: z.string().optional().describe("Business object id; omit to export all objects as a ZIP"),
      target: targetParam,
      outputPath: z.string().optional().describe("Write the file here instead of returning CSV inline"),
    }),
    annotations: { ...READ, openWorldHint: true },
  },
  toolHandler(async (params) => vbcsApi.exportBusinessObjectData(params))
);

server.registerTool(
  "vbcs_import_bo_data",
  {
    description:
      "Import business-object data into a standalone VBCS instance from a local .csv/.xls/.xlsx (one object; file name must equal the object id) or .zip (several). `mode` is required: 'append' adds rows, 'replace' OVERWRITES the object's existing data. Lock a live app first.",
    inputSchema: z.object({
      appName: z.string(),
      appVersion: z.string(),
      filePath: z.string().describe("Local file to upload"),
      mode: z.enum(["append", "replace"]).describe("append = add rows; replace = overwrite existing data"),
      boName: z.string().optional().describe("Defaults to the file name; omit for .zip"),
      target: targetParam,
    }),
    annotations: DESTRUCTIVE,
  },
  toolHandler(async (params) => vbcsApi.importBusinessObjectData(params))
);

// --- VB Studio CI (Builds API) ---------------------------------------------

server.registerTool(
  "vbstudio_trigger_build",
  {
    description:
      "Start a VB Studio CI job (also how you run a deploy job/pipeline step) via the documented Builds REST API. Returns the build number. The API base is derived from the repo's git remote. Credentials: VBSTUDIO_API_TOKEN, or VBSTUDIO_API_USERNAME/PASSWORD (falling back to the git credentials).",
    inputSchema: z.object({
      repo: repoParam,
      jobName: z.string(),
      paramsYaml: z.string().optional().describe("Job parameters as YAML (see vbstudio_job_params); omit for a job with none"),
    }),
    annotations: REMOTE_WRITE,
  },
  toolHandler(async ({ repo, jobName, paramsYaml }) => vbstudioApi.triggerBuild({ repoRoot: repo ? resolveRepoRoot(repo) : undefined, jobName, paramsYaml }))
);

server.registerTool(
  "vbstudio_build_status",
  {
    description: "Get the status (e.g. SUCCESSFUL) of a VB Studio CI build from its job name and build number.",
    inputSchema: z.object({ repo: repoParam, jobName: z.string(), buildNumber: z.number().int().positive() }),
    annotations: { ...READ, openWorldHint: true },
  },
  toolHandler(async ({ repo, jobName, buildNumber }) => vbstudioApi.getBuildStatus({ repoRoot: repo ? resolveRepoRoot(repo) : undefined, jobName, buildNumber }))
);

server.registerTool(
  "vbstudio_job_params",
  {
    description: "Get a parameterized VB Studio CI job's parameter definitions (YAML), to build the paramsYaml for vbstudio_trigger_build.",
    inputSchema: z.object({ repo: repoParam, jobName: z.string() }),
    annotations: { ...READ, openWorldHint: true },
  },
  toolHandler(async ({ repo, jobName }) => vbstudioApi.getJobParams({ repoRoot: repo ? resolveRepoRoot(repo) : undefined, jobName }))
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logAction("ovb3-bridge MCP server started", { version: "0.3.2" });
}

main().catch((err) => {
  logError("fatal startup error", { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
