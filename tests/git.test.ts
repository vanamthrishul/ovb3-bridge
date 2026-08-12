import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { simpleGit } from "simple-git";

import { gitClone } from "../src/tools/git.js";
import { VbcsRepoError } from "../src/lib/vbcs-repo.js";

describe("gitClone", () => {
  let workspaceDir: string;
  let remoteDir: string;
  const originalWorkspace = process.env.VBS_WORKSPACE_DIR;

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "vbcs-toolkit-workspace-"));
    remoteDir = await fs.mkdtemp(path.join(os.tmpdir(), "vbcs-toolkit-remote-"));

    const remote = simpleGit({ baseDir: remoteDir });
    await remote.init(["--bare"]);

    const seedDir = await fs.mkdtemp(path.join(os.tmpdir(), "vbcs-toolkit-seed-"));
    const seed = simpleGit({ baseDir: seedDir });
    await seed.init();
    await seed.addConfig("user.email", "test@example.com");
    await seed.addConfig("user.name", "Test");
    await fs.writeFile(path.join(seedDir, "visual-application.json"), "{}", "utf8");
    await seed.add(".");
    await seed.commit("seed");
    await seed.addRemote("origin", remoteDir);
    await seed.push("origin", "master");
    await fs.rm(seedDir, { recursive: true, force: true });

    process.env.VBS_WORKSPACE_DIR = workspaceDir;
  });

  afterEach(async () => {
    if (originalWorkspace === undefined) delete process.env.VBS_WORKSPACE_DIR;
    else process.env.VBS_WORKSPACE_DIR = originalWorkspace;
    await fs.rm(workspaceDir, { recursive: true, force: true });
    await fs.rm(remoteDir, { recursive: true, force: true });
  });

  it("clones a remote into VBS_WORKSPACE_DIR/destName", async () => {
    const result = await gitClone(remoteDir, "cloned-repo");
    expect(result.path).toBe(path.join(workspaceDir, "cloned-repo"));
    const onDisk = await fs.readFile(path.join(result.path, "visual-application.json"), "utf8");
    expect(onDisk).toBe("{}");
  });

  it("throws VbcsRepoError when VBS_WORKSPACE_DIR is unset", async () => {
    delete process.env.VBS_WORKSPACE_DIR;
    await expect(gitClone(remoteDir, "cloned-repo")).rejects.toThrow(VbcsRepoError);
  });
});
