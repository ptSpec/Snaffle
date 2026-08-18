export type SubagentProfile = {
  enabled: boolean;
  modelMode: "main" | "fixed";
  providerConnectionId: string;
  model: string;
  overflowProviderConnectionId: string;
  overflowModel: string;
  maxSteps: number;
};

export type ThreadSubagentMode = "inherit" | "enabled" | "disabled";

export const DEFAULT_SUBAGENT_MAX_STEPS = 50;

export function subagentProfile(value: unknown): SubagentProfile {
  const input = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const providerConnectionId = text(input.providerConnectionId);
  const model = text(input.model);
  const modelMode = input.modelMode === "main" || input.modelMode === "fixed"
    ? input.modelMode
    : providerConnectionId && model ? "fixed" : "main";
  const overflowProviderConnectionId = text(input.overflowProviderConnectionId);
  const overflowModel = text(input.overflowModel);
  const useOverflow = Boolean(
    overflowProviderConnectionId && overflowModel && (
      modelMode === "main" || overflowProviderConnectionId !== providerConnectionId
    ),
  );
  return {
    enabled: input.enabled === true,
    modelMode,
    providerConnectionId: modelMode === "fixed" ? providerConnectionId : "",
    model: modelMode === "fixed" ? model : "",
    overflowProviderConnectionId: useOverflow ? overflowProviderConnectionId : "",
    overflowModel: useOverflow ? overflowModel : "",
    maxSteps: Number.isInteger(input.maxSteps) && Number(input.maxSteps) >= 0 && Number(input.maxSteps) <= 250
      ? Number(input.maxSteps)
      : DEFAULT_SUBAGENT_MAX_STEPS,
  };
}

export function activeSubagent(profile: SubagentProfile): SubagentProfile | null {
  const hasModel = profile.modelMode === "main" || Boolean(profile.providerConnectionId && profile.model);
  return profile.enabled && hasModel && profile.maxSteps > 0 ? profile : null;
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
