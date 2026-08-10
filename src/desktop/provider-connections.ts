import { randomUUID } from "node:crypto";
import {
  OPENROUTER_CONNECTION_ID,
  providerDefinition,
  providerDefinitions,
} from "../providers/registry.js";
import type {
  ProviderConnection,
  ProviderConnectionInput,
  ResolvedProviderConnection,
} from "../providers/provider.js";
import { DEFAULT_PROVIDER_REQUEST_LIMIT } from "../providers/provider.js";
import { decodeSecret, encodeSecret } from "./settings.js";

export class ProviderConnections {
  private readonly connections = new Map<string, ProviderConnection>();
  private readonly secrets = new Map<string, string>();

  constructor(
    raw: unknown,
    private readonly environmentKeys: Record<string, string> = {},
    private readonly legacyRequestLimits: Record<string, number> = {},
  ) {
    for (const value of Array.isArray(raw) ? raw : []) this.load(value);
    if (!this.connections.has(OPENROUTER_CONNECTION_ID)) {
      const definition = providerDefinition("openrouter");
      this.connections.set(OPENROUTER_CONNECTION_ID, {
        id: OPENROUTER_CONNECTION_ID,
        providerId: definition.id,
        name: definition.name,
        baseUrl: definition.defaultBaseUrl,
        enabled: true,
        requestLimit: legacyRequestLimits[OPENROUTER_CONNECTION_ID] ?? DEFAULT_PROVIDER_REQUEST_LIMIT,
        hasApiKey: Boolean(environmentKeys.openrouter),
        manualModels: [],
      });
    }
  }

  list(): ProviderConnection[] {
    return [...this.connections.values()].map((connection) => ({
      ...connection,
      hasApiKey: Boolean(this.key(connection.id)),
    }));
  }

  resolve(id: string): ResolvedProviderConnection {
    const connection = this.connections.get(id);
    if (!connection || !connection.enabled) throw new Error("The selected provider connection is unavailable");
    const apiKey = this.key(id);
    return { ...connection, hasApiKey: Boolean(apiKey), ...(apiKey ? { apiKey } : {}) };
  }

  save(input: ProviderConnectionInput): ProviderConnection {
    const existing = input.id ? this.connections.get(input.id) : undefined;
    const definition = providerDefinition(input.providerId);
    const id = existing?.id ?? (input.id || randomUUID());
    const connection: ProviderConnection = {
      id,
      providerId: definition.id,
      name: input.name.trim() || definition.name,
      baseUrl: (input.baseUrl.trim() || definition.defaultBaseUrl).replace(/\/$/, ""),
      enabled: input.enabled,
      requestLimit: input.requestLimit,
      hasApiKey: false,
      manualModels: input.manualModels,
    };
    this.connections.set(id, connection);
    if (input.apiKey !== undefined) {
      if (input.apiKey.trim()) this.secrets.set(id, input.apiKey.trim());
      else this.secrets.delete(id);
    }
    return { ...connection, hasApiKey: Boolean(this.key(id)) };
  }

  remove(id: string): void {
    if (id === OPENROUTER_CONNECTION_ID) throw new Error("The built-in OpenRouter connection cannot be removed");
    this.connections.delete(id);
    this.secrets.delete(id);
  }

  serialize(): unknown[] {
    return [...this.connections.values()].map(({ hasApiKey: _hasApiKey, ...connection }) => ({
      ...connection,
      ...(this.secrets.get(connection.id)
        ? { apiKey: encodeSecret(this.secrets.get(connection.id)!) }
        : {}),
    }));
  }

  private key(id: string): string {
    const connection = this.connections.get(id);
    return this.secrets.get(id) || (connection ? this.environmentKeys[connection.providerId] : "") || "";
  }

  private load(raw: unknown): void {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
    const value = raw as Record<string, unknown>;
    if (
      typeof value.id !== "string" || typeof value.providerId !== "string" ||
      typeof value.name !== "string" || typeof value.baseUrl !== "string"
    ) return;
    if (!providerDefinitions().some((definition) => definition.id === value.providerId)) return;
    const secret = decodeSecret(value.apiKey);
    if (secret) this.secrets.set(value.id, secret);
    this.connections.set(value.id, {
      id: value.id,
      providerId: value.providerId,
      name: value.name,
      baseUrl: value.baseUrl,
      enabled: value.enabled !== false,
      requestLimit: providerRequestLimit(value.requestLimit)
        ?? this.legacyRequestLimits[value.id]
        ?? DEFAULT_PROVIDER_REQUEST_LIMIT,
      hasApiKey: Boolean(secret),
      manualModels: Array.isArray(value.manualModels)
        ? value.manualModels.filter(isProviderModel)
        : [],
    });
  }
}

function providerRequestLimit(value: unknown): number | undefined {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 16
    ? Number(value)
    : undefined;
}

function isProviderModel(value: unknown): value is ProviderConnection["manualModels"][number] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const model = value as Record<string, unknown>;
  return typeof model.id === "string" && typeof model.name === "string" &&
    typeof model.contextLength === "number" && Array.isArray(model.inputModalities) &&
    model.inputModalities.every((item) => typeof item === "string");
}
