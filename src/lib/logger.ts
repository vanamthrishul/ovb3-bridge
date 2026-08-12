/**
 * Every tool action is logged here so the user can see what the toolkit is
 * doing in real time — which artifact was read/written, what git/build
 * command ran, etc. Always writes to stderr: when the MCP server is running
 * over stdio, stdout is reserved for JSON-RPC protocol frames, so stderr is
 * the only safe channel (Claude Code / MCP hosts surface server stderr in
 * their logs). The CLI additionally echoes to stdout since it owns the
 * whole stream there.
 */

export type LogLevel = "info" | "warn" | "error";

export interface LogFields {
  [key: string]: unknown;
}

function format(level: LogLevel, action: string, fields?: LogFields): string {
  const ts = new Date().toISOString();
  const suffix = fields && Object.keys(fields).length > 0 ? ` ${JSON.stringify(fields)}` : "";
  return `[${ts}] [${level.toUpperCase()}] ${action}${suffix}`;
}

export function logAction(action: string, fields?: LogFields): void {
  process.stderr.write(format("info", action, fields) + "\n");
}

export function logWarn(action: string, fields?: LogFields): void {
  process.stderr.write(format("warn", action, fields) + "\n");
}

export function logError(action: string, fields?: LogFields): void {
  process.stderr.write(format("error", action, fields) + "\n");
}

/**
 * Wraps an async tool handler so entry, success/failure, and duration are
 * always logged without repeating boilerplate in every tool.
 */
export async function withLogging<T>(
  action: string,
  fields: LogFields,
  fn: () => Promise<T>
): Promise<T> {
  const startedAt = Date.now();
  logAction(`${action}: start`, fields);
  try {
    const result = await fn();
    logAction(`${action}: done`, { ...fields, ms: Date.now() - startedAt });
    return result;
  } catch (err) {
    logError(`${action}: failed`, {
      ...fields,
      ms: Date.now() - startedAt,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
