import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { withLogging } from "../lib/logger.js";

/**
 * REST client for a standalone Oracle VBCS instance's design-time API — for
 * VBCS apps that are NOT backed by a VB Studio project (no git remote), so
 * the artifact/git tools in artifacts.ts and git.ts can't reach them.
 *
 * Endpoint shapes are confirmed against Oracle's published docs and live calls:
 *   https://docs.oracle.com/en/cloud/paas/app-builder-cloud/vb-rest-apis/rest-endpoints.html
 *   https://docs.oracle.com/en/cloud/paas/application-integration/visual-developer/import-export-data-from-command-line.html
 *
 * Oracle publishes exactly 14 endpoints for this API: application list/lock/
 * unlock, the token endpoint, credential CRUD, and data export/import. There
 * is no whole-app export/import, version, build or deploy endpoint — that's a
 * property of Oracle's API, not a gap here.
 *
 * Separate product/API from VB Studio's own REST API (vbstudio-api.ts):
 * different base URL, different auth.
 */

export class VbcsApiError extends Error {}

const REQUEST_TIMEOUT_MS = 30_000;
/** Token lifetime isn't published, so cache conservatively and rely on the 401-retry below for expiry. */
const TOKEN_TTL_MS = 5 * 60_000;

let cachedToken: { value: string; baseUrl: string; user: string; expiresAt: number } | undefined;

/** Test hook / explicit logout. */
export function clearTokenCache(): void {
  cachedToken = undefined;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new VbcsApiError(`${name} is not set. Run /link to configure a standalone VBCS instance, or set it in .env / plugin config.`);
  }
  return value;
}

function baseUrl(): string {
  return requireEnv("VBCS_BASE_URL").replace(/\/+$/, "").replace(/\/ic\/builder$/i, "");
}

/**
 * Gets an OAuth token via POST {VBCS_BASE_URL}/ic/builder/public/token
 * (form-urlencoded; the real endpoint requires lowercase "username" even
 * though Oracle's docs page says "userName" — confirmed live). Cached per
 * base-URL+user; vbcsRequest() drops it and retries once on a 401.
 */
async function getAccessToken(forceFresh = false): Promise<string> {
  const base = baseUrl();
  const username = requireEnv("VBCS_IDCS_USERNAME");
  const password = requireEnv("VBCS_IDCS_PASSWORD");

  if (!forceFresh && cachedToken && cachedToken.baseUrl === base && cachedToken.user === username && cachedToken.expiresAt > Date.now()) {
    return cachedToken.value;
  }

  const res = await fetch(`${base}/ic/builder/public/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username, password }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new VbcsApiError(
      `VBCS token request failed: ${res.status} ${res.statusText} — ${detail}` +
        (res.status === 401 || res.status === 400 ? "\nCheck VBCS_IDCS_USERNAME / VBCS_IDCS_PASSWORD." : "")
    );
  }

  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) {
    throw new VbcsApiError("VBCS token response did not include an access_token field.");
  }
  const ttl = typeof data.expires_in === "number" && data.expires_in > 30 ? Math.min(TOKEN_TTL_MS, (data.expires_in - 30) * 1000) : TOKEN_TTL_MS;
  cachedToken = { value: data.access_token, baseUrl: base, user: username, expiresAt: Date.now() + ttl };
  return data.access_token;
}

/**
 * One authenticated request: cached bearer token, a hard timeout, and a single
 * transparent re-auth if the token turns out to have expired.
 */
async function vbcsRequest(pathAndQuery: string, init: RequestInit = {}): Promise<Response> {
  const base = baseUrl();
  const send = async (token: string) =>
    fetch(`${base}${pathAndQuery}`, {
      ...init,
      headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS * 4),
    });

  let res = await send(await getAccessToken());
  if (res.status === 401) {
    res = await send(await getAccessToken(true));
  }
  if (!res.ok) {
    throw new VbcsApiError(`VBCS API call to ${pathAndQuery} failed: ${res.status} ${res.statusText} — ${await res.text()}`);
  }
  return res;
}

async function vbcsJson(pathAndQuery: string, init?: RequestInit): Promise<unknown> {
  const text = await (await vbcsRequest(pathAndQuery, init)).text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

export async function listApplications(params?: { filter?: string }): Promise<unknown> {
  return withLogging("vbcsListApplications", { filter: params?.filter }, async () => {
    const query = params?.filter ? `?filter=${encodeURIComponent(params.filter)}` : "";
    return vbcsJson(`/ic/builder/resources/application/applist${query}`);
  });
}

export async function lockApplication(params: { branchId: string }): Promise<unknown> {
  return withLogging("vbcsLockApplication", params, () =>
    vbcsJson(`/ic/builder/resources/application/lock/${encodeURIComponent(params.branchId)}`, { method: "POST" })
  );
}

export async function unlockApplication(params: { branchId: string }): Promise<unknown> {
  return withLogging("vbcsUnlockApplication", params, () =>
    vbcsJson(`/ic/builder/resources/application/unlock/${encodeURIComponent(params.branchId)}`, { method: "POST" })
  );
}

export type DataTarget = "design" | "deployment";

function dataPath(params: { appName: string; appVersion: string; target?: DataTarget }, op: "export" | "import", boName?: string): string {
  const target = params.target ?? "design";
  const bo = boName ? `/${encodeURIComponent(boName)}` : "";
  return `/ic/builder/${target}/${encodeURIComponent(params.appName)}/${encodeURIComponent(params.appVersion)}/resources/datamgr/${op}${bo}`;
}

export interface ExportResult {
  contentType: string;
  bytes: number;
  /** Set when the payload was written to disk (always for zip; for CSV when outputPath was given). */
  savedTo?: string;
  /** The CSV text, for a single-object export without outputPath. */
  csv?: string;
}

/**
 * Exports one business object's data (CSV) — or every object's data as a ZIP
 * of CSVs when boName is omitted. `target: "deployment"` reads the
 * staging/live database instead of design-time. Binary-safe: the response is
 * CSV or ZIP, never JSON. Lock a live app first (vbcs_lock_application).
 */
export async function exportBusinessObjectData(params: {
  appName: string;
  appVersion: string;
  boName?: string;
  target?: DataTarget;
  outputPath?: string;
}): Promise<ExportResult> {
  return withLogging("vbcsExportBusinessObjectData", params, async () => {
    const res = await vbcsRequest(dataPath(params, "export", params.boName));
    const buffer = Buffer.from(await res.arrayBuffer());
    const contentType = res.headers.get("content-type") ?? "application/octet-stream";
    const isZip = /zip/i.test(contentType) || (buffer.length > 3 && buffer[0] === 0x50 && buffer[1] === 0x4b);

    let savedTo = params.outputPath ? path.resolve(params.outputPath) : undefined;
    if (!savedTo && isZip) {
      savedTo = path.join(os.tmpdir(), `ovb3-export-${params.appName}-${Date.now()}.zip`);
    }
    if (savedTo) {
      await fs.mkdir(path.dirname(savedTo), { recursive: true });
      await fs.writeFile(savedTo, buffer);
      return { contentType, bytes: buffer.length, savedTo };
    }
    return { contentType, bytes: buffer.length, csv: buffer.toString("utf8") };
  });
}

const IMPORT_CONTENT_TYPES: Record<string, string> = {
  ".csv": "text/csv",
  ".zip": "application/zip",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

/**
 * Imports business-object data from a local file: .csv/.xls/.xlsx into ONE
 * object (file name must equal the object id, per Oracle), or a .zip of those
 * into several. Sent as the raw request body, exactly as Oracle's documented
 * curl examples do (`-T file`), not multipart.
 *
 * Oracle's default is to REPLACE the object's existing data, so `mode` is
 * required — "append" adds rows (append=true), "replace" overwrites them.
 * `target: "deployment"` writes the staging/live database. Lock a live app
 * first (vbcs_lock_application).
 */
export async function importBusinessObjectData(params: {
  appName: string;
  appVersion: string;
  filePath: string;
  mode: "append" | "replace";
  boName?: string;
  target?: DataTarget;
}): Promise<{ status: number; bytesSent: number; boName?: string; mode: string; target: DataTarget }> {
  return withLogging("vbcsImportBusinessObjectData", { ...params }, async () => {
    const file = path.resolve(params.filePath);
    const ext = path.extname(file).toLowerCase();
    const contentType = IMPORT_CONTENT_TYPES[ext];
    if (!contentType) {
      throw new VbcsApiError(`Unsupported import file type "${ext}" — use .csv, .xls, .xlsx (one object) or .zip (several).`);
    }

    let boName = params.boName;
    if (ext === ".zip") {
      if (boName) throw new VbcsApiError("boName must be omitted for a .zip import — the files inside name their own objects.");
    } else {
      const stem = path.basename(file, ext);
      if (!boName) boName = stem;
      if (boName !== stem) {
        throw new VbcsApiError(
          `Oracle requires the file name to match the business object id: expected "${boName}${ext}", got "${path.basename(file)}".`
        );
      }
    }

    const body = await fs.readFile(file);
    const query = params.mode === "append" ? "?append=true" : "";
    const res = await vbcsRequest(`${dataPath(params, "import", boName)}${query}`, {
      method: "POST",
      headers: { "Content-Type": contentType },
      body,
    });
    return { status: res.status, bytesSent: body.length, boName, mode: params.mode, target: params.target ?? "design" };
  });
}
