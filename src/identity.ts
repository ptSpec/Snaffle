export const PRODUCT = {
  name: "Esch",
  slug: "esch",
  tagline: "Extremely Simple Coding Harness",
} as const;

export const ENV_PREFIX = PRODUCT.slug.toUpperCase();
export const LOCAL_STATE_DIRECTORY = `.${PRODUCT.slug}`;
