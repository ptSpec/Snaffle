export type SubagentProfile = {
  enabled: boolean;
  providerConnectionId: string;
  model: string;
  maxSteps: number;
  overflowProviderConnectionId: string;
  overflowModel: string;
};

export type ThreadSubagentMode = "inherit" | "enabled" | "disabled";

export const DEFAULT_SUBAGENT_MAX_STEPS = 30;

export function subagentProfile(value: unknown): SubagentProfile {
  const input = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    enabled: input.enabled === true,
    providerConnectionId: text(input.providerConnectionId),
    model: text(input.model),
    maxSteps: Number.isInteger(input.maxSteps) && Number(input.maxSteps) >= 0 && Number(input.maxSteps) <= 100
      ? Number(input.maxSteps)
      : DEFAULT_SUBAGENT_MAX_STEPS,
    overflowProviderConnectionId: text(input.overflowProviderConnectionId),
    overflowModel: text(input.overflowModel),
  };
}

export function activeSubagent(profile: SubagentProfile): SubagentProfile | null {
  return profile.enabled && profile.providerConnectionId && profile.model && profile.maxSteps > 0 ? profile : null;
}

export function threadSubagent(
  profile: SubagentProfile,
  mode: ThreadSubagentMode,
): SubagentProfile | null {
  if (mode === "disabled") return null;
  return activeSubagent(mode === "enabled" ? { ...profile, enabled: true } : profile);
}

export function isThreadSubagentMode(value: unknown): value is ThreadSubagentMode {
  return value === "inherit" || value === "enabled" || value === "disabled";
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
