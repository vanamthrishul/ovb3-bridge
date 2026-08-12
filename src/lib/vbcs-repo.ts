import path from "node:path";
import fs from "node:fs";

/**
 * Layout helpers for VB Studio project git checkouts, confirmed against a
 * real cloned project repo:
 *
 *   <repoRoot>/
 *     visual-application.json   # project-wide, one per repo
 *     services/<name>/openapi3.json, catalog.json   # project-wide, shared by all apps in the repo
 *     settings/                 # project-wide: dependencies.json, deployment-profiles.json, user-roles.json
 *     webApps/<app>/
 *       flows/*, chains/*, pages/*, fragments/*, resources/*
 *       settings/                # app-scoped: build.json, appShellCache.json, dependencies.json
 *
 * Earlier drafts of this helper assumed services/settings/visual-application.json
 * lived under webApps/<app>/ — that was wrong. A VB Studio project repo can
 * back multiple web/mobile apps that share one set of backend services, so
 * those are project-root scoped, not per-app.
 *
 * The toolkit targets a whole VBS *instance*, not one hardcoded app: an
 * instance hosts multiple VB Studio projects (each a separate git repo), and
 * each repo can hold multiple VBCS web apps under webApps/. Callers pass
 * repo and app identifiers per call; VBS_WORKSPACE_DIR just gives a place to
 * discover local checkouts from instead of requiring them to be known ahead
 * of time.
 */

export class VbcsRepoError extends Error {}

/**
 * Root directory containing local checkouts of one or more VB Studio project
 * repos (e.g. workspace/<project-repo>/, workspace/<other-repo>/). Used for
 * discovery (listRepos) and as the base when a repo is given by name rather
 * than absolute path.
 */
export function resolveWorkspaceDir(): string | undefined {
  const dir = process.env.VBS_WORKSPACE_DIR;
  if (!dir) return undefined;
  const resolved = path.resolve(dir);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new VbcsRepoError(`VBS_WORKSPACE_DIR does not exist or is not a directory: ${resolved}`);
  }
  return resolved;
}

/**
 * Resolves a repo checkout to an absolute path. Accepts:
 *  - an absolute path to any local git checkout
 *  - a repo name looked up under VBS_WORKSPACE_DIR
 *  - nothing, falling back to VBCS_REPO_PATH as a single-repo convenience
 *    default for setups that only work against one project.
 */
export function resolveRepoRoot(repoIdentifier?: string): string {
  if (repoIdentifier && path.isAbsolute(repoIdentifier)) {
    return assertDir(repoIdentifier, `Repo path does not exist or is not a directory: ${repoIdentifier}`);
  }

  if (repoIdentifier) {
    const workspace = resolveWorkspaceDir();
    if (!workspace) {
      throw new VbcsRepoError(
        `Repo "${repoIdentifier}" was given as a name (not an absolute path) but VBS_WORKSPACE_DIR is not set.`
      );
    }
    const candidate = path.resolve(workspace, repoIdentifier);
    return assertDir(candidate, `Repo "${repoIdentifier}" not found under VBS_WORKSPACE_DIR (${workspace}).`);
  }

  const fallback = process.env.VBCS_REPO_PATH;
  if (!fallback) {
    throw new VbcsRepoError(
      "No repo specified. Pass an absolute repo path or a repo name (resolved under VBS_WORKSPACE_DIR), " +
        "or set VBCS_REPO_PATH as a single-repo default. Use listRepos() to see what's available."
    );
  }
  return assertDir(path.resolve(fallback), `VBCS_REPO_PATH does not exist or is not a directory: ${fallback}`);
}

function assertDir(resolved: string, message: string): string {
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new VbcsRepoError(message);
  }
  return resolved;
}

/**
 * Lists local project repo checkouts under VBS_WORKSPACE_DIR (any directory
 * containing a .git folder). This is local-filesystem discovery only — full
 * instance-level project discovery belongs in vbstudio-api.ts once the REST
 * API is confirmed against a live instance.
 */
export function listRepos(): string[] {
  const workspace = resolveWorkspaceDir();
  if (!workspace) return [];
  return fs
    .readdirSync(workspace, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(workspace, entry.name, ".git")))
    .map((entry) => entry.name)
    .sort();
}

/** Lists VBCS web app names present in a repo checkout (webApps/<app>/). */
export function listApps(repoRoot: string): string[] {
  const webAppsRoot = path.join(repoRoot, "webApps");
  if (!fs.existsSync(webAppsRoot)) return [];
  return fs
    .readdirSync(webAppsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

export function resolveAppName(repoRoot: string, explicitApp?: string): string {
  const app = explicitApp ?? process.env.VBCS_APP_NAME;
  if (!app) {
    const available = listApps(repoRoot);
    throw new VbcsRepoError(
      available.length > 0
        ? `No app name given. Apps available in this repo: ${available.join(", ")}`
        : "No app name given and no webApps/ found in this repo."
    );
  }
  return app;
}

/**
 * Resolves a repo-relative artifact path safely, refusing anything that
 * would escape the repo root (e.g. via "..").
 */
export function resolveArtifactPath(repoRoot: string, relativePath: string): string {
  const resolved = path.resolve(repoRoot, relativePath);
  const relativeToRoot = path.relative(repoRoot, resolved);
  if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
    throw new VbcsRepoError(`Path escapes repo root: ${relativePath}`);
  }
  return resolved;
}

export function webAppDir(repoRoot: string, appName: string): string {
  return resolveArtifactPath(repoRoot, path.join("webApps", appName));
}

/** App-scoped: flows/*, per webApps/<app>/. */
export function flowsDir(repoRoot: string, appName: string): string {
  return path.join(webAppDir(repoRoot, appName), "flows");
}

/** App-scoped: chains/*, per webApps/<app>/. */
export function chainsDir(repoRoot: string, appName: string): string {
  return path.join(webAppDir(repoRoot, appName), "chains");
}

/** App-scoped: pages/*, per webApps/<app>/. */
export function pagesDir(repoRoot: string, appName: string): string {
  return path.join(webAppDir(repoRoot, appName), "pages");
}

/** App-scoped settings (build.json, appShellCache.json, ...), distinct from the project-wide settingsDir(). */
export function appSettingsDir(repoRoot: string, appName: string): string {
  return path.join(webAppDir(repoRoot, appName), "settings");
}

/** Project-wide: services/<name>/, shared by every app in the repo — not nested under webApps/<app>/. */
export function servicesDir(repoRoot: string): string {
  return resolveArtifactPath(repoRoot, "services");
}

/** Project-wide: dependencies.json, deployment-profiles.json, user-roles.json — one per repo. */
export function settingsDir(repoRoot: string): string {
  return resolveArtifactPath(repoRoot, "settings");
}

/** Project-wide: one visual-application.json per repo. */
export function visualApplicationJsonPath(repoRoot: string): string {
  return resolveArtifactPath(repoRoot, "visual-application.json");
}
