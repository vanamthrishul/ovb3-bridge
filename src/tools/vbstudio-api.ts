import { logWarn } from "../lib/logger.js";

/**
 * VB Studio / VBCS REST API calls (CI/CD builds, environment management,
 * deploy, etc). Per the project brief, this is BLOCKED until a real dev
 * instance + credentials are available: we do not fabricate endpoint paths
 * or payload shapes. Every function here throws until it's replaced with a
 * real implementation confirmed against that instance's actual behavior.
 */

export class VbStudioApiNotImplementedError extends Error {
  constructor(operation: string) {
    super(
      `${operation} is not implemented yet. VB Studio's own REST API shape must be confirmed against a ` +
        `live dev instance before this is wired up — none has been provided/confirmed yet.`
    );
    this.name = "VbStudioApiNotImplementedError";
  }
}

function stub(operation: string): never {
  logWarn("vbstudioApi: called unimplemented stub", { operation });
  throw new VbStudioApiNotImplementedError(operation);
}

// --- Instance-level (spans all projects on the VBS instance) ---------------

export async function listProjects(): Promise<never> {
  return stub("listProjects");
}

export async function listRepositories(_params: { projectKey: string }): Promise<never> {
  return stub("listRepositories");
}

// --- Project/app-scoped ------------------------------------------------

export async function listEnvironments(_params: { projectKey: string }): Promise<never> {
  return stub("listEnvironments");
}

export async function triggerBuild(_params: { projectKey: string; appName: string; environment?: string }): Promise<never> {
  return stub("triggerBuild");
}

export async function getBuildStatus(_params: { projectKey: string; buildId: string }): Promise<never> {
  return stub("getBuildStatus");
}

export async function triggerDeploy(_params: { projectKey: string; appName: string; environment: string }): Promise<never> {
  return stub("triggerDeploy");
}
