export type SubagentProfile = {
  enabled: boolean;
  providerConnectionId: string;
  model: string;
  maxSteps: number;
};

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
  };
}

export function activeSubagent(profile: SubagentProfile): SubagentProfile | null {
  return profile.enabled && profile.providerConnectionId && profile.model && profile.maxSteps > 0 ? profile : null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
