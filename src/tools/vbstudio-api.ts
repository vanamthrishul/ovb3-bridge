import { simpleGit } from "simple-git";
import { withLogging } from "../lib/logger.js";

/**
 * VB Studio's own hosted CI REST API (the "Builds API") — NOT the same thing
 * as the grunt-vb-build/grunt-vb-audit tasks in build.ts, which run locally.
 * This one starts and monitors jobs in VB Studio's CI service over HTTP.
 *
 * Shapes below come from Oracle's published docs, not guesses:
 *   base   https://<server>/<org-id>/rest/<org-id_project-id>/cibuild/v1/<resource>
 *   start  POST jobs/{job}/build   (Content-Type text/plain; body {} or YAML params)
 *          -> plain text "jobs/<jobId>/builds/<n>"
 *   params GET  jobs/{job}/params  -> YAML parameter definitions
 *   status GET  jobs/{job}/builds/{n}/status -> plain text, e.g. SUCCESSFUL
 *   auth   HTTP Basic (VB Studio user + password) or `Authorization: Bearer <PAT>`
 *   https://docs.oracle.com/en/cloud/paas/visual-builder/visualbuilder-rest-apis/send-requests.html
 *   https://docs.oracle.com/en/cloud/paas/visual-builder/visualbuilder-rest-apis/submit-build.html
 *
 * Deliberately NOT implemented: project/repository/environment listing and a
 * "deploy" call. Oracle's published Builds API has no such endpoints — in VB
 * Studio, deploys are just jobs or pipelines, so use triggerBuild on the
 * deploy job. Pipeline endpoints exist but their request shapes weren't
 * retrievable from the docs, so they're left out rather than guessed.
 */

export class VbStudioApiError extends Error {}

const REQUEST_TIMEOUT_MS = 30_000;
const SAFE_JOB = /^[A-Za-z0-9 _.-]+$/;

/**
 * Derives the Builds API base from a VB Studio git remote:
 *   https://host/<org>/s/<org>_<project>/scm/<repo>.git
 *   -> https://host/<org>/rest/<org>_<project>/cibuild/v1
 * (Oracle: the project id is "in the Maven or Git repository URL, before /scm/".)
 */
export function deriveBuildsBase(remoteUrl: string): string {
  let url: URL;
  try {
    url = new URL(remoteUrl);
  } catch {
    throw new VbStudioApiError(`Can't derive a VB Studio API base from "${remoteUrl}" — not an http(s) URL.`);
  }
  const match = url.pathname.match(/^\/([^/]+)\/s\/([^/]+)\/(?:scm|maven)\//);
  if (!match) {
    throw new VbStudioApiError(
      `"${url.origin}${url.pathname}" doesn't look like a VB Studio repo URL (expected /<org>/s/<org>_<project>/scm/<repo>.git). ` +
        `Set VBSTUDIO_API_BASE_URL to https://<server>/<org-id>/rest/<org-id_project-id> instead.`
    );
  }
  return `${url.origin}/${match[1]}/rest/${match[2]}/cibuild/v1`;
}

/** Resolves the Builds API base: explicit VBSTUDIO_API_BASE_URL wins, else derived from the repo's origin remote. */
export async function resolveBuildsBase(repoRoot?: string): Promise<string> {
  const explicit = process.env.VBSTUDIO_API_BASE_URL?.replace(/\/+$/, "");
  if (explicit) return explicit.endsWith("/cibuild/v1") ? explicit : `${explicit}/cibuild/v1`;

  const remote = repoRoot ? (await simpleGit({ baseDir: repoRoot }).remote(["get-url", "origin"]))?.toString().trim() : process.env.VBSTUDIO_GIT_REMOTE_URL;
  if (!remote) {
    throw new VbStudioApiError("No VB Studio project to target: pass a repo checkout, or set VBSTUDIO_API_BASE_URL / VBSTUDIO_GIT_REMOTE_URL.");
  }
  return deriveBuildsBase(remote);
}

/** Bearer PAT if VBSTUDIO_API_TOKEN is set, else Basic with the API (or git) credentials. */
export function authHeader(env: NodeJS.ProcessEnv = process.env): string {
  if (env.VBSTUDIO_API_TOKEN) return `Bearer ${env.VBSTUDIO_API_TOKEN}`;
  const user = env.VBSTUDIO_API_USERNAME ?? env.VBSTUDIO_GIT_USERNAME;
  const pass = env.VBSTUDIO_API_PASSWORD ?? env.VBSTUDIO_GIT_TOKEN;
  if (!user || !pass) {
    throw new VbStudioApiError(
      "No VB Studio API credentials. Set VBSTUDIO_API_TOKEN (personal access token), or VBSTUDIO_API_USERNAME + VBSTUDIO_API_PASSWORD " +
        "(these fall back to VBSTUDIO_GIT_USERNAME / VBSTUDIO_GIT_TOKEN)."
    );
  }
  return `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
}

function assertJob(jobName: string): string {
  if (!SAFE_JOB.test(jobName)) throw new VbStudioApiError(`Invalid job name "${jobName}".`);
  return encodeURIComponent(jobName);
}

async function builds(repoRoot: string | undefined, resource: string, init: RequestInit = {}): Promise<string> {
  const base = await resolveBuildsBase(repoRoot);
  const res = await fetch(`${base}/${resource}`, {
    ...init,
    headers: { Authorization: authHeader(), ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) {
    const hint = res.status === 401 ? " — check VBSTUDIO_API_TOKEN, or VBSTUDIO_API_USERNAME/PASSWORD." : res.status === 404 ? " — check the job name and project." : "";
    throw new VbStudioApiError(`VB Studio API ${resource} failed: ${res.status} ${res.statusText}${hint}\n${text.slice(0, 500)}`);
  }
  return text.trim();
}

/** Starts a CI job. `paramsYaml` is the job's parameter YAML (see getJobParams); omit for a job with no parameters. */
export async function triggerBuild(params: {
  repoRoot?: string;
  jobName: string;
  paramsYaml?: string;
}): Promise<{ jobName: string; buildPath: string; buildNumber: number }> {
  return withLogging("vbstudioTriggerBuild", { jobName: params.jobName }, async () => {
    const text = await builds(params.repoRoot, `jobs/${assertJob(params.jobName)}/build`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: params.paramsYaml?.trim() ? params.paramsYaml : "{}",
    });
    const buildNumber = Number(text.split("/").pop());
    if (!Number.isInteger(buildNumber)) {
      throw new VbStudioApiError(`Unexpected response starting "${params.jobName}": ${text.slice(0, 200)}`);
    }
    return { jobName: params.jobName, buildPath: text, buildNumber };
  });
}

/** Status of one build, e.g. SUCCESSFUL (plain text from Oracle; values aren't enumerated in the docs, so passed through verbatim). */
export async function getBuildStatus(params: {
  repoRoot?: string;
  jobName: string;
  buildNumber: number;
}): Promise<{ jobName: string; buildNumber: number; status: string }> {
  return withLogging("vbstudioGetBuildStatus", { jobName: params.jobName, buildNumber: params.buildNumber }, async () => {
    if (!Number.isInteger(params.buildNumber) || params.buildNumber < 1) {
      throw new VbStudioApiError(`Invalid build number ${params.buildNumber}.`);
    }
    const status = await builds(params.repoRoot, `jobs/${assertJob(params.jobName)}/builds/${params.buildNumber}/status`);
    return { jobName: params.jobName, buildNumber: params.buildNumber, status };
  });
}

/** A parameterized job's parameter definitions, as the YAML Oracle returns. */
export async function getJobParams(params: { repoRoot?: string; jobName: string }): Promise<{ jobName: string; yaml: string }> {
  return withLogging("vbstudioGetJobParams", { jobName: params.jobName }, async () => ({
    jobName: params.jobName,
    yaml: await builds(params.repoRoot, `jobs/${assertJob(params.jobName)}/params`),
  }));
}
