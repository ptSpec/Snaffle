export type SkillSource = "project" | "personal";

export type SkillSummary = {
  name: string;
  description: string;
  source: SkillSource;
};

export type Skill = SkillSummary & {
  directory: string;
  instructions: string;
};
