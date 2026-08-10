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
    {
      name: "release-notes",
      description: "Prepare concise release notes",
      source: "project",
      origin: "agents",
      compatibility: "compatible",
    },
  );
  assert.match(registry.read("release-notes"), /Use references\/style\.md/);
  assert.equal(
    registry.read("release-notes", "references/style.md"),
    "Lead with user-visible changes.\n",
  );
});

test("Codex skills disclose unknown compatibility and declared missing tools are blocked", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "skill-compatibility-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const imported = path.join(root, ".codex", "skills", "pet-maker");
  const blocked = path.join(root, ".snaffle", "skills", "image-workflow");
  await mkdir(imported, { recursive: true });
  await mkdir(blocked, { recursive: true });
  await writeFile(path.join(imported, "SKILL.md"), [
    "---",
    "name: pet-maker",
    "description: Make a Codex pet",
    "---",
    "Use Codex image generation.",
  ].join("\n"));
  await writeFile(path.join(blocked, "SKILL.md"), [
    "---",
    "name: image-workflow",
    "description: Generate an image",
    "metadata:",
    "  snaffle.dev/required-tools: imagegen",
    "---",
    "Generate an image.",
  ].join("\n"));

  const skills = new SkillRegistry(root).summaries();
  assert.equal(skills.find((skill) => skill.name === "pet-maker")?.compatibility, "unknown");
  assert.match(new SkillRegistry(root).read("pet-maker"), /Compatibility: unknown/);
  assert.deepEqual(
    skills.find((skill) => skill.name === "image-workflow"),
    {
      name: "image-workflow",
      description: "Generate an image",
      source: "project",
      origin: "snaffle",
      compatibility: "incompatible",
      compatibilityNote: "Missing required tools: imagegen.",
    },
  );
  assert.throws(() => new SkillRegistry(root).read("image-workflow"), /Missing required tools: imagegen/);
});
