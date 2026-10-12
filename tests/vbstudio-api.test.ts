import { describe, it, expect, afterEach, vi } from "vitest";

import { authHeader, deriveBuildsBase, getBuildStatus, getJobParams, resolveBuildsBase, triggerBuild, VbStudioApiError } from "../src/tools/vbstudio-api.js";

const REMOTE = "https://vbs.example.com/myorg/s/myorg_proj_123/scm/Repo.git";
const BASE = "https://vbs.example.com/myorg/rest/myorg_proj_123/cibuild/v1";

const ENV = ["VBSTUDIO_API_BASE_URL", "VBSTUDIO_GIT_REMOTE_URL", "VBSTUDIO_API_TOKEN", "VBSTUDIO_API_USERNAME", "VBSTUDIO_API_PASSWORD", "VBSTUDIO_GIT_USERNAME", "VBSTUDIO_GIT_TOKEN"];

describe("vbstudio-api (Builds REST API)", () => {
  const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  afterEach(() => {
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    vi.unstubAllGlobals();
  });

  function setup(env: Record<string, string>) {
    for (const k of ENV) delete process.env[k];
    Object.assign(process.env, env);
  }

  it("derives the Builds API base from a VB Studio git remote", () => {
    expect(deriveBuildsBase(REMOTE)).toBe(BASE);
    expect(deriveBuildsBase("https://vbs.example.com/myorg/s/myorg_proj_123/maven/x")).toBe(BASE);
  });

  it("rejects remotes that don't look like VB Studio", () => {
    expect(() => deriveBuildsBase("https://github.com/a/b.git")).toThrow(VbStudioApiError);
    expect(() => deriveBuildsBase("not a url")).toThrow(VbStudioApiError);
  });

  it("prefers an explicit VBSTUDIO_API_BASE_URL and appends /cibuild/v1 once", async () => {
    setup({ VBSTUDIO_API_BASE_URL: "https://h/org/rest/org_p/" });
    expect(await resolveBuildsBase()).toBe("https://h/org/rest/org_p/cibuild/v1");
    setup({ VBSTUDIO_API_BASE_URL: "https://h/org/rest/org_p/cibuild/v1" });
    expect(await resolveBuildsBase()).toBe("https://h/org/rest/org_p/cibuild/v1");
  });

  it("falls back to VBSTUDIO_GIT_REMOTE_URL when no repo is given", async () => {
    setup({ VBSTUDIO_GIT_REMOTE_URL: REMOTE });
    expect(await resolveBuildsBase()).toBe(BASE);
  });

  it("chooses bearer over basic, and falls back to git credentials", () => {
    expect(authHeader({ VBSTUDIO_API_TOKEN: "pat", VBSTUDIO_GIT_USERNAME: "u", VBSTUDIO_GIT_TOKEN: "t" })).toBe("Bearer pat");
    expect(authHeader({ VBSTUDIO_GIT_USERNAME: "u", VBSTUDIO_GIT_TOKEN: "t" })).toBe(`Basic ${Buffer.from("u:t").toString("base64")}`);
    expect(authHeader({ VBSTUDIO_API_USERNAME: "a", VBSTUDIO_API_PASSWORD: "b", VBSTUDIO_GIT_USERNAME: "u", VBSTUDIO_GIT_TOKEN: "t" })).toBe(
      `Basic ${Buffer.from("a:b").toString("base64")}`
    );
    expect(() => authHeader({})).toThrow(/No VB Studio API credentials/);
  });

  it("starts a job exactly as Oracle documents it and parses the build number", async () => {
    setup({ VBSTUDIO_GIT_REMOTE_URL: REMOTE, VBSTUDIO_API_TOKEN: "pat" });
    const fetchMock = vi.fn(async () => new Response("jobs/JOBID-1/builds/40\n", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await triggerBuild({ jobName: "My Job" });
    expect(r).toEqual({ jobName: "My Job", buildPath: "jobs/JOBID-1/builds/40", buildNumber: 40 });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${BASE}/jobs/My%20Job/build`);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("text/plain");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer pat");
    expect(init.body).toBe("{}");
  });

  it("sends parameter YAML as the body when given", async () => {
    setup({ VBSTUDIO_GIT_REMOTE_URL: REMOTE, VBSTUDIO_API_TOKEN: "pat" });
    const fetchMock = vi.fn(async () => new Response("jobs/J/builds/7", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await triggerBuild({ jobName: "J", paramsYaml: "params:\n- A=\"1\"" });
    expect((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body).toBe('params:\n- A="1"');
  });

  it("reads status and params", async () => {
    setup({ VBSTUDIO_GIT_REMOTE_URL: REMOTE, VBSTUDIO_API_TOKEN: "pat" });
    const fetchMock = vi.fn(async (url: string) => new Response(url.endsWith("/status") ? "SUCCESSFUL" : "params:\n- X=\"1\"", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await getBuildStatus({ jobName: "J", buildNumber: 41 })).toEqual({ jobName: "J", buildNumber: 41, status: "SUCCESSFUL" });
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe(`${BASE}/jobs/J/builds/41/status`);
    expect((await getJobParams({ jobName: "J" })).yaml).toContain("X=");
  });

  it("explains a 401 and a 404, and rejects unsafe job names / build numbers", async () => {
    setup({ VBSTUDIO_GIT_REMOTE_URL: REMOTE, VBSTUDIO_API_TOKEN: "pat" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>401</html>", { status: 401, statusText: "Unauthorized" })));
    await expect(getJobParams({ jobName: "J" })).rejects.toThrow(/VBSTUDIO_API_TOKEN/);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404, statusText: "Not Found" })));
    await expect(getJobParams({ jobName: "J" })).rejects.toThrow(/job name and project/);
    await expect(triggerBuild({ jobName: "a/../b" })).rejects.toThrow(/Invalid job name/);
    await expect(getBuildStatus({ jobName: "J", buildNumber: 0 })).rejects.toThrow(/Invalid build number/);
  });
});
