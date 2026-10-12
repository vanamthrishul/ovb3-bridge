import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { clearTokenCache, exportBusinessObjectData, importBusinessObjectData, listApplications, VbcsApiError } from "../src/tools/vbcs-api.js";

const ENV_KEYS = ["VBCS_BASE_URL", "VBCS_IDCS_USERNAME", "VBCS_IDCS_PASSWORD"] as const;

describe("vbcs-api: token cache, retry, and data import/export", () => {
  const saved: Record<string, string | undefined> = {};
  let tmp: string;

  beforeEach(async () => {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    process.env.VBCS_BASE_URL = "https://vbcs.example.com/ic/builder/"; // trailing /ic/builder must be tolerated
    process.env.VBCS_IDCS_USERNAME = "u";
    process.env.VBCS_IDCS_PASSWORD = "p";
    clearTokenCache();
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ovb3-vbcs-"));
  });

  afterEach(async () => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    vi.unstubAllGlobals();
    await fs.rm(tmp, { recursive: true, force: true });
  });

  /** Token endpoint stub + a handler for everything else; records calls. */
  function stubFetch(handler: (url: string, init?: RequestInit) => Response, tokens = ["tok-1", "tok-2"]) {
    let issued = 0;
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        if (url.endsWith("/ic/builder/public/token")) return new Response(JSON.stringify({ access_token: tokens[issued++] ?? "tok-n" }), { status: 200 });
        return handler(url, init);
      })
    );
    return { calls, tokenRequests: () => calls.filter((c) => c.url.endsWith("/public/token")).length };
  }

  it("normalises a base URL that already ends in /ic/builder", async () => {
    const { calls } = stubFetch(() => new Response("{}", { status: 200 }));
    await listApplications();
    expect(calls[0].url).toBe("https://vbcs.example.com/ic/builder/public/token");
  });

  it("reuses the cached token across calls", async () => {
    const stub = stubFetch(() => new Response("{}", { status: 200 }));
    await listApplications();
    await listApplications();
    expect(stub.tokenRequests()).toBe(1);
  });

  it("re-authenticates once when the token has expired (401), then succeeds", async () => {
    let n = 0;
    const stub = stubFetch(() => (n++ === 0 ? new Response("expired", { status: 401 }) : new Response('{"ok":true}', { status: 200 })));
    await expect(listApplications()).resolves.toEqual({ ok: true });
    expect(stub.tokenRequests()).toBe(2);
  });

  it("gives up after the single retry and reports the failure", async () => {
    stubFetch(() => new Response("nope", { status: 401 }));
    await expect(listApplications()).rejects.toBeInstanceOf(VbcsApiError);
  });

  it("returns non-JSON bodies instead of crashing on JSON.parse", async () => {
    stubFetch(() => new Response("plain text", { status: 200 }));
    await expect(listApplications()).resolves.toEqual({ text: "plain text" });
  });

  it("exports a single object as inline CSV (never JSON-parsed)", async () => {
    const { calls } = stubFetch(() => new Response("id,name\n1,a\n", { status: 200, headers: { "content-type": "text/csv" } }));
    const r = await exportBusinessObjectData({ appName: "App", appVersion: "1.0", boName: "Orders" });
    expect(r.csv).toBe("id,name\n1,a\n");
    expect(calls.at(-1)!.url).toBe("https://vbcs.example.com/ic/builder/design/App/1.0/resources/datamgr/export/Orders");
  });

  it("exports everything as a ZIP saved to disk, and can target the deployment database", async () => {
    const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]);
    const { calls } = stubFetch(() => new Response(zip, { status: 200, headers: { "content-type": "application/zip" } }));
    const out = path.join(tmp, "all.zip");
    const r = await exportBusinessObjectData({ appName: "App", appVersion: "1.0", target: "deployment", outputPath: out });
    expect(r.savedTo).toBe(out);
    expect((await fs.readFile(out)).equals(zip)).toBe(true);
    expect(calls.at(-1)!.url).toBe("https://vbcs.example.com/ic/builder/deployment/App/1.0/resources/datamgr/export");
  });

  it("imports a CSV as the raw body with the right content type; replace has no append flag", async () => {
    const { calls } = stubFetch(() => new Response("", { status: 200 }));
    const file = path.join(tmp, "Orders.csv");
    await fs.writeFile(file, "id\n1\n");
    const r = await importBusinessObjectData({ appName: "App", appVersion: "1.0", filePath: file, mode: "replace" });
    const call = calls.at(-1)!;
    expect(call.url).toBe("https://vbcs.example.com/ic/builder/design/App/1.0/resources/datamgr/import/Orders");
    expect((call.init!.headers as Record<string, string>)["Content-Type"]).toBe("text/csv");
    expect(Buffer.from(call.init!.body as Buffer).toString()).toBe("id\n1\n");
    expect(r).toMatchObject({ boName: "Orders", mode: "replace", status: 200 });
  });

  it("append mode adds ?append=true; zip goes to the all-objects endpoint", async () => {
    const { calls } = stubFetch(() => new Response("", { status: 200 }));
    const csv = path.join(tmp, "Orders.csv");
    await fs.writeFile(csv, "id\n");
    await importBusinessObjectData({ appName: "App", appVersion: "1.0", filePath: csv, mode: "append", target: "deployment" });
    expect(calls.at(-1)!.url).toBe("https://vbcs.example.com/ic/builder/deployment/App/1.0/resources/datamgr/import/Orders?append=true");

    const zip = path.join(tmp, "data.zip");
    await fs.writeFile(zip, "PK");
    await importBusinessObjectData({ appName: "App", appVersion: "1.0", filePath: zip, mode: "replace" });
    const call = calls.at(-1)!;
    expect(call.url).toBe("https://vbcs.example.com/ic/builder/design/App/1.0/resources/datamgr/import");
    expect((call.init!.headers as Record<string, string>)["Content-Type"]).toBe("application/zip");
  });

  it("refuses imports Oracle would misinterpret: name mismatch, boName on a zip, unknown type", async () => {
    stubFetch(() => new Response("", { status: 200 }));
    const csv = path.join(tmp, "Orders.csv");
    const zip = path.join(tmp, "d.zip");
    const txt = path.join(tmp, "x.txt");
    await Promise.all([fs.writeFile(csv, "a"), fs.writeFile(zip, "a"), fs.writeFile(txt, "a")]);
    await expect(importBusinessObjectData({ appName: "A", appVersion: "1", filePath: csv, boName: "Other", mode: "append" })).rejects.toThrow(/file name to match/);
    await expect(importBusinessObjectData({ appName: "A", appVersion: "1", filePath: zip, boName: "Orders", mode: "append" })).rejects.toThrow(/omitted for a \.zip/);
    await expect(importBusinessObjectData({ appName: "A", appVersion: "1", filePath: txt, mode: "append" })).rejects.toThrow(/Unsupported import file type/);
  });
});
