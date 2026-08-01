export const PRODUCT = {
  name: "Esch",
  slug: "esch",
} as const;

export const ENV_PREFIX = PRODUCT.slug.toUpperCase();
export const LOCAL_STATE_DIRECTORY = `.${PRODUCT.slug}`;
