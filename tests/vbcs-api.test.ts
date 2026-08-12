import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { VbcsApiError, listApplications } from "../src/tools/vbcs-api.js";

describe("vbcs-api (standalone VBCS REST client)", () => {
  const originalEnv = {
    VBCS_BASE_URL: process.env.VBCS_BASE_URL,
    VBCS_IDCS_USERNAME: process.env.VBCS_IDCS_USERNAME,
    VBCS_IDCS_PASSWORD: process.env.VBCS_IDCS_PASSWORD,
  };

  beforeEach(() => {
    process.env.VBCS_BASE_URL = "https://vbcs.example.com";
    process.env.VBCS_IDCS_USERNAME = "test-user";
    process.env.VBCS_IDCS_PASSWORD = "test-pass";
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    vi.unstubAllGlobals();
  });

  it("fetches a token with form-urlencoded credentials, then uses it as a bearer token", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/ic/builder/public/token")) {
        expect(init?.method).toBe("POST");
        expect(String((init?.headers as Record<string, string>)["Content-Type"])).toBe("application/x-www-form-urlencoded");
        expect((init?.body as URLSearchParams).toString()).toBe("username=test-user&password=test-pass");
        return new Response(JSON.stringify({ access_token: "fake-token" }), { status: 200 });
      }
      if (url.endsWith("/ic/builder/resources/application/applist")) {
        expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer fake-token");
        return new Response(JSON.stringify([{ name: "sampleApp" }]), { status: 200 });
      }
      throw new Error(`Unexpected fetch call: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await listApplications();
    expect(result).toEqual([{ name: "sampleApp" }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws VbcsApiError with the status code on a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/ic/builder/public/token")) {
          return new Response(JSON.stringify({ access_token: "fake-token" }), { status: 200 });
        }
        return new Response("forbidden", { status: 403, statusText: "Forbidden" });
      })
    );

    await expect(listApplications()).rejects.toThrow(VbcsApiError);
    await expect(listApplications()).rejects.toThrow(/403/);
  });

  it("throws VbcsApiError when required env vars are missing", async () => {
    delete process.env.VBCS_BASE_URL;
    await expect(listApplications()).rejects.toThrow(VbcsApiError);
  });
});
