import { logWarn, withLogging } from "../lib/logger.js";

/**
 * REST client for a standalone Oracle VBCS instance's design-time API — for
 * VBCS apps that are NOT backed by a VB Studio project (no git remote), so
 * the artifact/git tools in artifacts.ts and git.ts can't reach them.
 *
 * Endpoint shapes below are confirmed against Oracle's published docs, not
 * guessed:
 *   https://docs.oracle.com/en/cloud/paas/app-builder-cloud/vb-rest-apis/rest-endpoints.html
 *   https://docs.oracle.com/en/cloud/paas/app-builder-cloud/vb-rest-apis/op-ic-builder-public-token-post.html
 *
 * This is a separate product/API from VB Studio's own REST API in
 * vbstudio-api.ts (different base URL, different auth scheme) — do not merge
 * the two modules.
 */

export class VbcsApiError extends Error {}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new VbcsApiError(`${name} is not set. Run /link to configure a standalone VBCS instance, or set it in .env.`);
  }
  return value;
}

/**
 * Gets a fresh OAuth token via POST {VBCS_BASE_URL}/ic/builder/public/token
 * (form-urlencoded username/password — confirmed against a live instance;
 * Oracle's docs page names the param "userName" but the real endpoint
 * rejects that and requires lowercase "username"). Not cached: the real
 * token response shape (expires_in field name, etc.) isn't published, so
 * caching would mean guessing at it — fetch a fresh token per call for now.
 * TODO: cache using expires_in once the real response shape is confirmed
 * against a live instance.
 */
async function getAccessToken(): Promise<string> {
  const baseUrl = requireEnv("VBCS_BASE_URL");
  const username = requireEnv("VBCS_IDCS_USERNAME");
  const password = requireEnv("VBCS_IDCS_PASSWORD");

  const body = new URLSearchParams({ username, password });
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/ic/builder/public/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    throw new VbcsApiError(`VBCS token request failed: ${res.status} ${res.statusText} — ${await res.text()}`);
  }

  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) {
    throw new VbcsApiError(
      `VBCS token response did not include an access_token field — response shape may differ from what's assumed. Got: ${JSON.stringify(data)}`
    );
  }
  return data.access_token;
}

/** Centralizes base-URL join, bearer auth, and error handling for every VBCS REST call. */
async function vbcsFetch(pathAndQuery: string, init?: RequestInit): Promise<unknown> {
  const baseUrl = requireEnv("VBCS_BASE_URL");
  const token = await getAccessToken();

  const res = await fetch(`${baseUrl.replace(/\/$/, "")}${pathAndQuery}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    throw new VbcsApiError(`VBCS API call to ${pathAndQuery} failed: ${res.status} ${res.statusText} — ${await res.text()}`);
  }

  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export async function listApplications(params?: { filter?: string }): Promise<unknown> {
  return withLogging("vbcsListApplications", { filter: params?.filter }, async () => {
    const query = params?.filter ? `?filter=${encodeURIComponent(params.filter)}` : "";
    return vbcsFetch(`/ic/builder/resources/application/applist${query}`);
  });
}

export async function lockApplication(params: { branchId: string }): Promise<unknown> {
  return withLogging("vbcsLockApplication", params, () =>
    vbcsFetch(`/ic/builder/resources/application/lock/${encodeURIComponent(params.branchId)}`, { method: "POST" })
  );
}

export async function unlockApplication(params: { branchId: string }): Promise<unknown> {
  return withLogging("vbcsUnlockApplication", params, () =>
    vbcsFetch(`/ic/builder/resources/application/unlock/${encodeURIComponent(params.branchId)}`, { method: "POST" })
  );
}

export async function exportBusinessObjectData(params: {
  appName: string;
  appVersion: string;
  boName: string;
}): Promise<unknown> {
  return withLogging("vbcsExportBusinessObjectData", params, () =>
    vbcsFetch(
      `/ic/builder/design/${encodeURIComponent(params.appName)}/${encodeURIComponent(params.appVersion)}/resources/datamgr/export/${encodeURIComponent(params.boName)}`
    )
  );
}

/**
 * NOT IMPLEMENTED: the import request's body/content-type isn't published in
 * Oracle's docs (unlike export, which is a plain GET) — left stubbed rather
 * than guessing the upload format.
 */
export async function importBusinessObjectData(): Promise<never> {
  logWarn("vbcsApi: called unimplemented stub", { operation: "importBusinessObjectData" });
  throw new VbcsApiError(
    "importBusinessObjectData is not implemented — the VBCS import endpoint's request body/content-type isn't published in Oracle's docs and hasn't been confirmed against a live instance yet."
  );
}
