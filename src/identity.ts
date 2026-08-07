export const PROJECT = {
  name: "Snaffle",
  slug: "snaffle",
  domain: "snaffle.dev",
  tagline: "A simple coding harness",
} as const;

export const LEGACY_PROJECTS = [
  { name: "Esch", slug: "esch", envPrefix: "ESCH" },
] as const;

export const ENV_PREFIX = PROJECT.slug.toUpperCase();
export const LOCAL_STATE_DIRECTORY = `.${PROJECT.slug}`;

export function projectEnvironment(
  suffix: string,
  environment: Record<string, string | undefined>,
): string | undefined {
  return environment[`${ENV_PREFIX}_${suffix}`] ?? LEGACY_PROJECTS
    .map((project) => environment[`${project.envPrefix}_${suffix}`])
    .find((value) => value !== undefined);
}
