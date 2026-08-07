export const PRODUCT = {
  name: "Snaffle",
  slug: "snaffle",
  domain: "snaffle.dev",
  tagline: "A simple coding harness",
} as const;

export const LEGACY_PRODUCTS = [
  { name: "Esch", slug: "esch", envPrefix: "ESCH" },
] as const;

export const ENV_PREFIX = PRODUCT.slug.toUpperCase();
export const LOCAL_STATE_DIRECTORY = `.${PRODUCT.slug}`;

export function productEnvironment(
  suffix: string,
  environment: Record<string, string | undefined>,
): string | undefined {
  return environment[`${ENV_PREFIX}_${suffix}`] ?? LEGACY_PRODUCTS
    .map((product) => environment[`${product.envPrefix}_${suffix}`])
    .find((value) => value !== undefined);
}
