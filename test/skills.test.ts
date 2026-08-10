import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { SkillRegistry } from "../src/extensions/skills/index.js";

test("skills discover portable packages and prefer the project copy", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "skill-test-"));
  const projectSkill = path.join(root, "workspace", ".agents", "skills", "release-notes");
  const personalSkill = path.join(root, "personal", "release-notes");
  t.after(() => rm(root, { recursive: true, force: true }));

  await mkdir(path.join(projectSkill, "references"), { recursive: true });
  await mkdir(personalSkill, { recursive: true });
  await writeFile(path.join(projectSkill, "SKILL.md"), [
    "---",
    "name: release-notes",
    "description: Prepare concise release notes",
    "---",
    "Use references/style.md when writing the final notes.",
  ].join("\n"));
  await writeFile(path.join(projectSkill, "references", "style.md"), "Lead with user-visible changes.\n");
  await writeFile(path.join(personalSkill, "SKILL.md"), [
    "---",
    "name: release-notes",
    "description: Personal copy that should lose",
    "---",
    "Personal instructions.",
  ].join("\n"));

  const registry = new SkillRegistry(path.join(root, "workspace"), path.join(root, "personal"));

  assert.deepEqual(
    registry.search("release notes").find((skill) => skill.name === "release-notes"),
    { name: "release-notes", description: "Prepare concise release notes", source: "project" },
  );
  assert.match(registry.read("release-notes"), /Use references\/style\.md/);
  assert.equal(
    registry.read("release-notes", "references/style.md"),
    "Lead with user-visible changes.\n",
  );
});
