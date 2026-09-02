import type {
  ProviderCatalog,
  ProviderConnection,
  ProviderModel,
} from "../../providers/provider.js";
import { isReasoningEffort } from "../../providers/provider.js";

const CACHE_KEY = "snaffle.provider-catalogs.v1";

export function readModelCatalogCache(
  connections: ProviderConnection[],
): ProviderCatalog[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(CACHE_KEY) ?? "null") as unknown;
    if (!Array.isArray(parsed)) return [];
    const current = new Map(connections.map((connection) => [connection.id, connection]));
    return parsed.flatMap((value) => {
      const catalog = parseCatalog(value);
      const connection = catalog && current.get(catalog.connection.id);
      return connection && connection.enabled && connection.providerId === catalog.connection.providerId &&
          connection.baseUrl === catalog.connection.baseUrl
        ? [{ ...catalog, connection }]
        : [];
    });
  } catch {
    return [];
  }
}

export function writeModelCatalogCache(catalogs: ProviderCatalog[]): void {
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(catalogs.map(({ error: _error, ...catalog }) => catalog)));
  } catch {
    // A fresh discovery still works when browser storage is unavailable or full.
  }
}

export function mergeModelCatalogRefresh(
  previous: ProviderCatalog[],
  refreshed: ProviderCatalog[],
): ProviderCatalog[] {
  const cached = new Map(previous.map((catalog) => [catalog.connection.id, catalog]));
  return refreshed.map((catalog) => {
    const prior = cached.get(catalog.connection.id);
    if (!catalog.error ||
        !prior?.models.length ||
        prior.connection.providerId !== catalog.connection.providerId ||
        prior.connection.baseUrl !== catalog.connection.baseUrl) return catalog;
    const models = [...prior.models];
    const ids = new Set(models.map((model) => model.id));
    for (const model of catalog.models) {
      if (!ids.has(model.id)) models.push(model);
    }
    return { ...catalog, models };
  });
}

function parseCatalog(value: unknown): ProviderCatalog | null {
  if (!record(value)) return null;
  const connection = parseConnection(value.connection);
  const models = parseModels(value.models);
  if (!connection || !models || !nonNegativeInteger(value.discoveredModelCount)) return null;
  return {
    connection,
    models,
    discoveredModelCount: value.discoveredModelCount,
    ...(typeof value.error === "string" ? { error: value.error } : {}),
  };
}

function parseConnection(value: unknown): ProviderConnection | null {
  if (!record(value) || !Array.isArray(value.manualModels)) return null;
  const manualModels = parseModels(value.manualModels);
  if (!manualModels ||
      typeof value.id !== "string" ||
      typeof value.providerId !== "string" ||
      typeof value.name !== "string" ||
      typeof value.baseUrl !== "string" ||
      typeof value.enabled !== "boolean" ||
      !nonNegativeInteger(value.requestLimit) ||
      typeof value.hasApiKey !== "boolean") return null;
  return {
    id: value.id,
    providerId: value.providerId,
    name: value.name,
    baseUrl: value.baseUrl,
    enabled: value.enabled,
    requestLimit: value.requestLimit,
    hasApiKey: value.hasApiKey,
    manualModels,
  };
}

function parseModels(value: unknown): ProviderModel[] | null {
  if (!Array.isArray(value)) return null;
  const models = value.map(parseModel);
  return models.every((model): model is ProviderModel => model !== null) ? models : null;
}

function parseModel(value: unknown): ProviderModel | null {
  if (!record(value) ||
      typeof value.id !== "string" ||
      typeof value.name !== "string" ||
      !nonNegativeInteger(value.contextLength) ||
      !Array.isArray(value.inputModalities) ||
      !value.inputModalities.every((item) => typeof item === "string")) return null;
  const reasoning = record(value.reasoning) && Array.isArray(value.reasoning.efforts) &&
      value.reasoning.efforts.every(isReasoningEffort)
    ? { efforts: value.reasoning.efforts }
    : undefined;
  return {
    id: value.id,
    name: value.name,
    contextLength: value.contextLength,
    inputModalities: value.inputModalities as string[],
    ...(typeof value.promptPrice === "string" || value.promptPrice === null
      ? { promptPrice: value.promptPrice }
      : {}),
    ...(typeof value.completionPrice === "string" || value.completionPrice === null
      ? { completionPrice: value.completionPrice }
      : {}),
    ...(reasoning ? { reasoning } : {}),
    ...(typeof value.toolUseUnavailableReason === "string"
      ? { toolUseUnavailableReason: value.toolUseUnavailableReason }
      : {}),
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}
