export type SkillSource = "project" | "personal";
export type SkillOrigin = "snaffle" | "agents" | "codex" | "claude";
export type SkillCompatibility = "compatible" | "unknown" | "incompatible";

export type SkillSummary = {
  name: string;
  description: string;
  source: SkillSource;
  origin: SkillOrigin;
  compatibility: SkillCompatibility;
  compatibilityNote?: string;
};

export type Skill = SkillSummary & {
  directory: string;
  instructions: string;
};
