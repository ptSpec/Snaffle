import { homedir } from "node:os";
import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import type { Skill, SkillSource, SkillSummary } from "./types.js";

const SKILL_FILE = "SKILL.md";
const MAX_RESOURCE_CHARACTERS = 50_000;
const VALID_SKILL_NAME = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

export class SkillRegistry {
  private readonly skills: Skill[];

  constructor(workspacePath?: string, personalRoot?: string) {
    this.skills = discoverSkills(workspacePath, personalRoot);
  }

  summaries(): SkillSummary[] {
    return this.skills.map(({ name, description, source }) => ({ name, description, source }));
  }

  search(query: string): SkillSummary[] {
    const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
    return this.skills
      .map((skill) => ({
        skill,
        score: words.reduce((score, word) =>
          score + (skill.name.toLowerCase().includes(word) ? 3 : 0) +
          (skill.description.toLowerCase().includes(word) ? 1 : 0), 0),
      }))
      .filter(({ score }) => !words.length || score > 0)
      .sort((left, right) => right.score - left.score || left.skill.name.localeCompare(right.skill.name))
      .slice(0, 12)
      .map(({ skill: { name, description, source } }) => ({ name, description, source }));
  }

  read(name: string, resource?: string): string {
    const skill = this.skills.find((item) => item.name.toLowerCase() === name.toLowerCase());
    if (!skill) throw new Error(`Unknown skill: ${name}`);
    if (!resource) {
      return `Loaded skill "${skill.name}" (${skill.source}).\n\n${skill.instructions}`;
    }

    const target = realpathSync(path.resolve(skill.directory, resource));
    assertInside(skill.directory, target);
    if (statSync(target).isDirectory()) throw new Error("Skill resources must be files");
    const content = readFileSync(target, "utf8");
    if (content.includes("\0")) throw new Error("Binary skill resources cannot be loaded as text");
    return content.length > MAX_RESOURCE_CHARACTERS
      ? `${content.slice(0, MAX_RESOURCE_CHARACTERS)}\n\n[Resource truncated at ${MAX_RESOURCE_CHARACTERS.toLocaleString()} characters]`
      : content;
  }
}

function discoverSkills(workspacePath?: string, personalRoot?: string): Skill[] {
  const roots: Array<{ directory: string; source: SkillSource }> = [];
  if (workspacePath) {
    for (const directory of [".snaffle/skills", ".agents/skills", ".codex/skills", ".claude/skills"]) {
      roots.push({ directory: path.join(workspacePath, directory), source: "project" });
    }
  }
  if (personalRoot) roots.push({ directory: personalRoot, source: "personal" });
  for (const directory of [".agents/skills", ".codex/skills", ".claude/skills"]) {
    roots.push({ directory: path.join(homedir(), directory), source: "personal" });
  }

  const found = new Map<string, Skill>();
  for (const root of roots) {
    for (const directory of childDirectories(root.directory)) {
      const skill = readSkill(directory, root.source);
      if (skill && !found.has(skill.name.toLowerCase())) found.set(skill.name.toLowerCase(), skill);
    }
  }
  return [...found.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function childDirectories(root: string): string[] {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
      .map((entry) => path.join(root, entry.name));
  } catch {
    return [];
  }
}

function readSkill(directory: string, source: SkillSource): Skill | undefined {
  try {
    const actualDirectory = realpathSync(directory);
    const instructions = readFileSync(path.join(actualDirectory, SKILL_FILE), "utf8");
    const frontmatter = parseFrontmatter(instructions);
    const name = typeof frontmatter.name === "string" ? frontmatter.name.trim() : "";
    const description = typeof frontmatter.description === "string" ? frontmatter.description.trim() : "";
    if (!VALID_SKILL_NAME.test(name) || !description) return undefined;
    return { name, description, source, directory: actualDirectory, instructions };
  } catch {
    return undefined;
  }
}

function parseFrontmatter(content: string): Record<string, unknown> {
  if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) return {};
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match?.[1]) return {};
  const value = parse(match[1]);
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function assertInside(root: string, target: string): void {
  const relative = path.relative(realpathSync(root), target);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Skill resource leaves the skill directory");
  }
}
