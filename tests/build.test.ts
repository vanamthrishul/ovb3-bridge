import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { assertSafeAppName, componentExchangeArgs, diagnose, findGruntBin, runBuild, setupBuildTools, BuildToolError } from "../src/tools/build.js";

describe("build tool safety + diagnosis", () => {
  it("accepts plain app names and rejects shell metacharacters", () => {
    expect(assertSafeAppName("my-app_2.0")).toBe("my-app_2.0");
    for (const bad of ["x; rm -rf /", "a b", "$(whoami)", "a&b", "`id`", "../x", ""]) {
      expect(() => assertSafeAppName(bad)).toThrow(BuildToolError);
    }
  });

  it("omits Component Exchange flags entirely when nothing is set", () => {
    expect(componentExchangeArgs({})).toEqual([]);
  });

  it("builds url:ce plus token or username/password flags", () => {
    expect(componentExchangeArgs({ VB_BUILD_COMPONENT_EXCHANGE_URL: "https://h.example/o/s/o_p/compcatalog/0.2.0" })).toEqual([
      "--url:ce=https://h.example/o/s/o_p/compcatalog/0.2.0",
    ]);
    expect(
      componentExchangeArgs({
        VB_BUILD_COMPONENT_EXCHANGE_URL: "https://h.example/x",
        VB_BUILD_CE_USERNAME: "u",
        VB_BUILD_CE_PASSWORD: "p",
      })
    ).toEqual(["--url:ce=https://h.example/x", "--username:ce=u", "--password:ce=p"]);
    // a token wins over username/password, as Oracle's docs specify
    expect(
      componentExchangeArgs({ VB_BUILD_COMPONENT_EXCHANGE_URL: "https://h.example/x", VB_BUILD_CE_ACCESS_TOKEN: "t", VB_BUILD_CE_USERNAME: "u", VB_BUILD_CE_PASSWORD: "p" })
    ).toEqual(["--url:ce=https://h.example/x", "--accessToken:ce=t"]);
  });

  it("refuses a Component Exchange URL containing shell-significant characters", () => {
    expect(() => componentExchangeArgs({ VB_BUILD_COMPONENT_EXCHANGE_URL: "https://h.example/x;calc" })).toThrow(BuildToolError);
    expect(() => componentExchangeArgs({ VB_BUILD_COMPONENT_EXCHANGE_URL: "https://h.example/x&y" })).toThrow(BuildToolError);
  });

  it("maps real, previously-observed failure output to a hint", () => {
    expect(diagnose("Fatal error: Missing mandatory component exchange URL")).toMatch(/Component Exchange URL/);
    expect(diagnose("ComponentExchangeCCAFinder: Cannot load oj-dcs-x")).toMatch(/VB_BUILD_COMPONENT_EXCHANGE_URL/);
    expect(diagnose("AuthenticationSystems: Backend fetch failed. status: 'ETIMEDOUT'")).toMatch(/live Visual Builder backend/);
    expect(diagnose("Error: Cannot find module 'x'")).toMatch(/setup_build_tools/);
    expect(diagnose("all good")).toBeUndefined();
  });
});

describe("build tool preflight", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "ovb3-build-"));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("explains how to install build tools when grunt-cli is missing", () => {
    expect(() => findGruntBin(dir)).toThrow(/setup_build_tools/);
  });

  it("finds grunt-cli when installed", async () => {
    const bin = path.join(dir, "node_modules", "grunt-cli", "bin", "grunt");
    await fs.mkdir(path.dirname(bin), { recursive: true });
    await fs.writeFile(bin, "", "utf8");
    expect(findGruntBin(dir)).toBe(bin);
  });

  it("runBuild rejects an injection-shaped app name before spawning anything", async () => {
    const bin = path.join(dir, "node_modules", "grunt-cli", "bin", "grunt");
    await fs.mkdir(path.dirname(bin), { recursive: true });
    await fs.writeFile(bin, "throw new Error('should never run')", "utf8");
    await expect(runBuild(dir, "x; echo pwned")).rejects.toThrow(/Invalid app name/);
  });

  it("runs the repo's grunt entry as a node script, with the task and --app args, no shell", async () => {
    const bin = path.join(dir, "node_modules", "grunt-cli", "bin", "grunt");
    await fs.mkdir(path.dirname(bin), { recursive: true });
    await fs.writeFile(bin, "console.log(JSON.stringify(process.argv.slice(2)))", "utf8");
    const result = await runBuild(dir, "demoApp");
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout.trim().split("\n").pop()!)).toEqual(["vb-build", "--app=demoApp"]);
  });

  it("surfaces a hint when the task fails with a known signature", async () => {
    const bin = path.join(dir, "node_modules", "grunt-cli", "bin", "grunt");
    await fs.mkdir(path.dirname(bin), { recursive: true });
    await fs.writeFile(bin, "console.error('Fatal error: Missing mandatory component exchange URL'); process.exit(3)", "utf8");
    const result = await runBuild(dir, "demoApp");
    expect(result.exitCode).toBe(3);
    expect(result.hint).toMatch(/Component Exchange/);
  });

  it("setupBuildTools refuses a folder that isn't a project", async () => {
    await expect(setupBuildTools(dir)).rejects.toThrow(/No package\.json/);
  });
});
