import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { readArtifact, writeArtifact, listArtifacts } from "../src/tools/artifacts.js";
import { VbcsRepoError, listApps, listRepos } from "../src/lib/vbcs-repo.js";

describe("artifacts tools", () => {
  let repoRoot: string;

  beforeEach(async () => {
    repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "vbcs-toolkit-test-"));
    await fs.mkdir(path.join(repoRoot, "webApps", "sampleApp", "flows", "main"), { recursive: true });
    await fs.writeFile(
      path.join(repoRoot, "webApps", "sampleApp", "flows", "main", "main-flow.json"),
      JSON.stringify({ id: "main-flow" }),
      "utf8"
    );
  });

  afterEach(async () => {
    await fs.rm(repoRoot, { recursive: true, force: true });
  });

  it("reads an existing JSON artifact and validates it parses", async () => {
    const result = await readArtifact(repoRoot, "webApps/sampleApp/flows/main/main-flow.json");
    expect(result.isJson).toBe(true);
    expect(JSON.parse(result.content)).toEqual({ id: "main-flow" });
  });

  it("writes a new artifact, creating parent directories", async () => {
    const relPath = "webApps/sampleApp/chains/newChain.json";
    const written = await writeArtifact(repoRoot, relPath, JSON.stringify({ id: "newChain" }));
    expect(written.path).toBe(relPath);
    const onDisk = await fs.readFile(path.join(repoRoot, relPath), "utf8");
    expect(JSON.parse(onDisk)).toEqual({ id: "newChain" });
  });

  it("refuses to write invalid JSON to a .json artifact", async () => {
    await expect(writeArtifact(repoRoot, "webApps/sampleApp/settings/broken.json", "{not json")).rejects.toThrow(
      VbcsRepoError
    );
  });

  it("refuses to read or write paths that escape the repo root", async () => {
    await expect(readArtifact(repoRoot, "../outside.json")).rejects.toThrow(VbcsRepoError);
    await expect(writeArtifact(repoRoot, "../../outside.json", "{}")).rejects.toThrow(VbcsRepoError);
  });

  it("lists artifacts matching a glob pattern", async () => {
    const matches = await listArtifacts(repoRoot, "webApps/*/flows/**/*.json");
    expect(matches).toEqual(["webApps/sampleApp/flows/main/main-flow.json"]);
  });

  it("lists apps present in a repo (instance can hold more than one)", () => {
    expect(listApps(repoRoot)).toEqual(["sampleApp"]);
  });

  it("lists no repos when VBS_WORKSPACE_DIR is unset", () => {
    const original = process.env.VBS_WORKSPACE_DIR;
    delete process.env.VBS_WORKSPACE_DIR;
    try {
      expect(listRepos()).toEqual([]);
    } finally {
      if (original !== undefined) process.env.VBS_WORKSPACE_DIR = original;
    }
  });
});
