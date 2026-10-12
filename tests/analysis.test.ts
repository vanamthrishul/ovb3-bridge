import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { auditServiceCalls, extractCallRests, matchBracket, searchArtifacts, topLevelKeys } from "../src/tools/analysis.js";

const chain = (extra: string) => `
define([], () => {
  class Chain extends ActionChain {
    async run(context) {
      // callRest in a comment: Actions.callRest(context, { endpoint: 'Nope/Nope' })
      const r = await Actions.callRest(context, {
        endpoint: 'Orders/getOrders',
        uriParams: { orderId: $variables.id, 'status': 'OPEN', ${extra} },
        requestType: 'json',
        headers: { 'X-Trace': "a,b}" },
      });
    }
  }
  return Chain;
});`;

describe("callRest extraction", () => {
  it("finds the endpoint, option names, and sub-object keys", () => {
    const [call] = extractCallRests(chain("region: 'EU'"));
    expect(call.endpoint).toBe("Orders/getOrders");
    expect(call.options).toEqual(["endpoint", "uriParams", "requestType", "headers"]);
    expect(call.keys.uriParams).toEqual(["orderId", "status", "region"]);
    expect(call.keys.headers).toEqual(["X-Trace"]);
  });

  it("ignores callRest inside comments' endpoints and counts only real calls", () => {
    const calls = extractCallRests(chain(""));
    expect(calls.map((c) => c.endpoint)).toEqual(["Orders/getOrders"]);
  });

  it("is not fooled by braces and commas inside strings", () => {
    const src = `Actions.callRest(ctx, { endpoint: 'A/b', body: { note: 'x}, y: {', k: 1 } })`;
    const [call] = extractCallRests(src);
    expect(call.keys.body).toEqual(["note", "k"]);
  });

  it("matchBracket and topLevelKeys handle nesting", () => {
    const s = "{ a: { b: 1, c: [1,2,{d:3}] }, 'e': 2, f }";
    expect(matchBracket(s, 0)).toBe(s.length - 1);
    expect(topLevelKeys(s)).toEqual(["a", "e", "f"]);
  });
});

describe("cross-app audit + content search", () => {
  let repo: string;
  beforeAll(async () => {
    repo = await fs.mkdtemp(path.join(os.tmpdir(), "ovb3-analysis-"));
    const put = async (rel: string, content: string) => {
      await fs.mkdir(path.dirname(path.join(repo, rel)), { recursive: true });
      await fs.writeFile(path.join(repo, rel), content, "utf8");
    };
    await put("webApps/appA/flows/main/pages/p-chains/get.js", chain("region: 'EU'"));
    await put("webApps/appB/flows/main/pages/p-chains/get.js", chain(""));
    await put("webApps/appB/flows/main/pages/p-chains/other.js", `Actions.callRest(c, { endpoint: 'Only/B', uriParams: { x: 1 } })`);
    await put("services/Orders/openapi3.json", `{"info":{"title":"Orders"}}`);
  });
  afterAll(async () => {
    await fs.rm(repo, { recursive: true, force: true });
  });

  it("flags a parameter one app sends and another omits", async () => {
    const audit = await auditServiceCalls(repo, {});
    expect(audit.appsScanned).toEqual(["appA", "appB"]);
    const orders = audit.endpoints.find((e) => e.endpoint === "Orders/getOrders")!;
    expect(orders.callCount).toBe(2);
    expect(orders.apps).toEqual(["appA", "appB"]);
    expect(orders.inconsistencies).toEqual([{ group: "uriParams", key: "region", usedBy: ["appA"], missingFrom: ["appB"] }]);
    expect(audit.endpoints.find((e) => e.endpoint === "Only/B")!.inconsistencies).toEqual([]);
  });

  it("can restrict to one endpoint and return call sites", async () => {
    const audit = await auditServiceCalls(repo, { endpoint: "Only/B", includeCalls: true });
    expect(audit.endpoints.map((e) => e.endpoint)).toEqual(["Only/B"]);
    expect(audit.calls?.[0]).toMatchObject({ app: "appB", file: "webApps/appB/flows/main/pages/p-chains/other.js", line: 1 });
  });

  it("searches content with line numbers, as substring and as regex", async () => {
    const sub = await searchArtifacts(repo, { query: "Orders/getOrders" });
    expect(sub.matches.map((m) => m.file)).toEqual([
      "webApps/appA/flows/main/pages/p-chains/get.js",
      "webApps/appB/flows/main/pages/p-chains/get.js",
    ]);
    expect(sub.matches[0].line).toBeGreaterThan(1);
    const re = await searchArtifacts(repo, { query: "endpoint:\\s*'Only/\\w", regex: true });
    expect(re.matches).toHaveLength(1);
    const none = await searchArtifacts(repo, { query: "not-there" });
    expect(none).toMatchObject({ matches: [], truncated: false });
  });

  it("honours maxResults", async () => {
    const r = await searchArtifacts(repo, { query: "endpoint", maxResults: 1 });
    expect(r.matches).toHaveLength(1);
    expect(r.truncated).toBe(true);
  });
});
