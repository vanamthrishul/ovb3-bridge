/**
 * Secret redaction for anything that gets logged or returned in an error.
 * Logs go to stderr where MCP hosts persist them, so a credential embedded in
 * a remote URL or a command line must never reach them verbatim.
 */

const URL_CREDENTIALS = /(\b[a-z][a-z0-9+.-]*:\/\/)([^/\s:@]+)(?::[^/\s@]*)?@/gi;
const SECRET_FLAGS = /(--(?:password|accessToken|token)(?::[a-z]+)?=)(\S+)/gi;
const BEARER = /(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi;
const BASIC = /(Basic\s+)[A-Za-z0-9+/=]{8,}/g;

/** Redacts credentials embedded in URLs, secret CLI flags, and auth headers inside a string. */
export function redactString(input: string): string {
  return input
    .replace(URL_CREDENTIALS, "$1***@")
    .replace(SECRET_FLAGS, "$1***")
    .replace(BEARER, "$1***")
    .replace(BASIC, "$1***");
}

/** Deep-redacts string values in a log-field object. Never mutates the input. */
export function redactValue(value: unknown): unknown {
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map(redactValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactValue(v)]));
  }
  return value;
}
