import fs from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import { withLogging } from "../lib/logger.js";
import { listApps } from "../lib/vbcs-repo.js";

const MAX_FILE_BYTES = 2_000_000;

// --- Content search -----------------------------------------------------

export interface SearchMatch {
  file: string;
  line: number;
  text: string;
}

/**
 * Greps artifact CONTENT (list_artifacts only matches file names). Plain
 * substring by default; set `regex` for a pattern. Skips binaries and huge files.
 */
export async function searchArtifacts(
  repoRoot: string,
  params: { query: string; glob?: string; regex?: boolean; ignoreCase?: boolean; maxResults?: number }
): Promise<{ matches: SearchMatch[]; truncated: boolean; filesScanned: number }> {
  return withLogging("searchArtifacts", { query: params.query, glob: params.glob }, async () => {
    const max = Math.min(Math.max(params.maxResults ?? 200, 1), 2000);
    const flags = params.ignoreCase ? "i" : "";
    const matcher = params.regex
      ? new RegExp(params.query, flags)
      : new RegExp(params.query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags);

    const files = await fg(params.glob ?? "{webApps,services,settings}/**/*.{js,json,html,css,md}", {
      cwd: repoRoot,
      ignore: ["**/node_modules/**", "**/build/**", "**/dist/**"],
      onlyFiles: true,
    });
    files.sort();

    const matches: SearchMatch[] = [];
    let scanned = 0;
    for (const file of files) {
      const abs = path.join(repoRoot, file);
      const stat = await fs.stat(abs);
      if (stat.size > MAX_FILE_BYTES) continue;
      scanned++;
      const lines = (await fs.readFile(abs, "utf8")).split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        if (matcher.test(lines[i])) {
          matches.push({ file, line: i + 1, text: lines[i].trim().slice(0, 300) });
          if (matches.length >= max) return { matches, truncated: true, filesScanned: scanned };
        }
      }
    }
    return { matches, truncated: false, filesScanned: scanned };
  });
}

// --- Service-call extraction --------------------------------------------

export interface ServiceCall {
  endpoint: string;
  line: number;
  /** Keys of each option sub-object (uriParams, body, headers, ...), by sub-object name. */
  keys: Record<string, string[]>;
  /** Top-level option names present on the call (endpoint, uriParams, requestType, ...). */
  options: string[];
}

/**
 * Index of the bracket matching the opener at `start`, skipping strings,
 * template literals and comments. Not a JS parser — it doesn't understand
 * regex literals containing brackets — but VBCS action-chain call sites are
 * plain object literals, which this handles exactly.
 */
export function matchBracket(src: string, start: number): number {
  const open = src[start];
  const close = open === "(" ? ")" : open === "{" ? "}" : "]";
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      for (i++; i < src.length && src[i] !== c; i++) if (src[i] === "\\") i++;
    } else if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
    } else if (c === "/" && src[i + 1] === "*") {
      i = src.indexOf("*/", i + 2);
      if (i < 0) return -1;
      i++;
    } else if (c === "(" || c === "{" || c === "[") {
      depth++;
    } else if (c === ")" || c === "}" || c === "]") {
      depth--;
      if (depth === 0) return c === close ? i : -1;
    }
  }
  return -1;
}

/** Property names at depth 1 of an object literal body (`{ a: 1, 'b': x, [c]: y, ...spread }`). */
export function topLevelKeys(objectLiteral: string): string[] {
  const keys: string[] = [];
  const body = objectLiteral.slice(1, -1);
  let depth = 0;
  let segmentStart = 0;
  const flush = (end: number) => {
    const segment = body.slice(segmentStart, end).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "").trim();
    const m = segment.match(/^(?:\.\.\.)?(?:["']([^"']+)["']|([A-Za-z_$][\w$]*))\s*(?::|,|$|\()/);
    if (m && !segment.startsWith("...")) keys.push(m[1] ?? m[2]);
  };
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '"' || c === "'" || c === "`") {
      for (i++; i < body.length && body[i] !== c; i++) if (body[i] === "\\") i++;
    } else if (c === "(" || c === "{" || c === "[") {
      depth++;
    } else if (c === ")" || c === "}" || c === "]") {
      depth--;
    } else if (c === "," && depth === 0) {
      flush(i);
      segmentStart = i + 1;
    }
  }
  flush(body.length);
  return keys;
}

/**
 * Blanks out line and block comments (string-aware) while preserving every
 * character offset and newline, so commented-out code is never mistaken for a
 * live call and reported line numbers still match the original file.
 */
export function maskComments(src: string): string {
  const out = src.split("");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      for (i++; i < src.length && src[i] !== c; i++) if (src[i] === "\\") i++;
    } else if (c === "/" && src[i + 1] === "/") {
      for (; i < src.length && src[i] !== "\n"; i++) out[i] = " ";
      i--;
    } else if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end < 0 ? src.length : end + 2;
      for (; i < stop; i++) if (src[i] !== "\n") out[i] = " ";
      i--;
    }
  }
  return out.join("");
}

/** Finds every Actions.callRest(context, { endpoint: 'Svc/Op', ... }) in a JS source string (comments ignored). */
export function extractCallRests(original: string): ServiceCall[] {
  const src = maskComments(original);
  const calls: ServiceCall[] = [];
  const re = /\bcallRest\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const openParen = m.index + m[0].length - 1;
    const closeParen = matchBracket(src, openParen);
    if (closeParen < 0) continue;
    const args = src.slice(openParen, closeParen + 1);
    const objStart = args.indexOf("{");
    if (objStart < 0) continue;
    const objAbs = openParen + objStart;
    const objEnd = matchBracket(src, objAbs);
    if (objEnd < 0) continue;
    const literal = src.slice(objAbs, objEnd + 1);

    const endpoint = literal.match(/\bendpoint\s*:\s*["'`]([^"'`]+)["'`]/)?.[1];
    if (!endpoint) continue;

    const options = topLevelKeys(literal);
    const keys: Record<string, string[]> = {};
    for (const sub of options) {
      if (sub === "endpoint") continue;
      const subMatch = new RegExp(`(?:^|[\\s,{])["']?${sub}["']?\\s*:\\s*\\{`).exec(literal);
      if (!subMatch) continue;
      const braceIdx = subMatch.index + subMatch[0].length - 1;
      const end = matchBracket(literal, braceIdx);
      if (end > 0) keys[sub] = topLevelKeys(literal.slice(braceIdx, end + 1));
    }
    calls.push({ endpoint, line: src.slice(0, m.index).split("\n").length, keys, options });
  }
  return calls;
}

export interface CallSite extends ServiceCall {
  app: string;
  file: string;
}

export interface ServiceCallAudit {
  appsScanned: string[];
  filesScanned: number;
  endpoints: Array<{
    endpoint: string;
    callCount: number;
    apps: string[];
    /** For each option sub-object, which apps use which keys. */
    keyUsage: Record<string, Record<string, string[]>>;
    /** Keys present in some of the apps that call this endpoint but missing from others. */
    inconsistencies: Array<{ group: string; key: string; usedBy: string[]; missingFrom: string[] }>;
  }>;
  calls?: CallSite[];
}

/**
 * Cross-app comparative audit of REST service usage. Walks every action-chain
 * JS file under webApps/<app>/, extracts each Actions.callRest call, and for
 * each endpoint compares which parameter KEYS (uriParams / body / headers…)
 * each app passes — flagging keys some apps send that others omit. Compares
 * key sets, not values: values are arbitrary expressions and not comparable.
 */
export async function auditServiceCalls(
  repoRoot: string,
  params: { endpoint?: string; apps?: string[]; includeCalls?: boolean }
): Promise<ServiceCallAudit> {
  return withLogging("auditServiceCalls", { endpoint: params.endpoint, apps: params.apps }, async () => {
    const apps = params.apps?.length ? params.apps : listApps(repoRoot);
    const sites: CallSite[] = [];
    let filesScanned = 0;

    for (const app of apps) {
      const files = await fg(`webApps/${app}/**/*.js`, { cwd: repoRoot, ignore: ["**/node_modules/**", "**/build/**"], onlyFiles: true });
      for (const file of files.sort()) {
        const abs = path.join(repoRoot, file);
        if ((await fs.stat(abs)).size > MAX_FILE_BYTES) continue;
        filesScanned++;
        const src = await fs.readFile(abs, "utf8");
        if (!src.includes("callRest")) continue;
        for (const call of extractCallRests(src)) {
          if (params.endpoint && call.endpoint !== params.endpoint) continue;
          sites.push({ ...call, app, file });
        }
      }
    }

    const byEndpoint = new Map<string, CallSite[]>();
    for (const site of sites) byEndpoint.set(site.endpoint, [...(byEndpoint.get(site.endpoint) ?? []), site]);

    const endpoints = [...byEndpoint.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([endpoint, list]) => {
      const appsUsing = [...new Set(list.map((s) => s.app))].sort();
      const keyUsage: Record<string, Record<string, string[]>> = {};
      for (const site of list) {
        for (const [group, keys] of Object.entries(site.keys)) {
          keyUsage[group] ??= {};
          for (const key of keys) {
            keyUsage[group][key] = [...new Set([...(keyUsage[group][key] ?? []), site.app])].sort();
          }
        }
      }
      const inconsistencies: ServiceCallAudit["endpoints"][number]["inconsistencies"] = [];
      for (const [group, keyMap] of Object.entries(keyUsage)) {
        for (const [key, usedBy] of Object.entries(keyMap)) {
          const missingFrom = appsUsing.filter((a) => !usedBy.includes(a));
          if (missingFrom.length > 0) inconsistencies.push({ group, key, usedBy, missingFrom });
        }
      }
      return { endpoint, callCount: list.length, apps: appsUsing, keyUsage, inconsistencies };
    });

    return { appsScanned: apps, filesScanned, endpoints, ...(params.includeCalls ? { calls: sites } : {}) };
  });
}
