import { ipcMain } from "electron";
import {
  OPENROUTER_CONNECTION_ID,
  providerCatalog,
  providerStatus,
} from "../../providers/registry.js";
import type {
  ProviderConnectionInput,
  ProviderModel,
} from "../../providers/provider.js";
import type { DesktopState } from "../api.js";
import type { ProviderConnections } from "../provider-connections.js";

export function registerProviderIpc(options: {
  connections: ProviderConnections;
  state(includeConversation?: boolean): Promise<DesktopState>;
  selected(): string;
  select(id: string): void;
  persist(): void;
}): void {
  ipcMain.handle("desktop:list-provider-models", async () => {
    return Promise.all(options.connections.list()
      .filter((connection) => connection.enabled)
      .map(async (connection) => {
        try {
          return await providerCatalog(options.connections.resolve(connection.id));
        } catch (error) {
          return {
            connection,
            models: connection.manualModels,
            discoveredModelCount: 0,
            error: errorMessage(error),
          };
        }
      }));
  });

  ipcMain.handle("desktop:get-provider-status", async (_event, rawId: unknown) => {
    return providerStatus(options.connections.resolve(parseId(rawId, "Provider connection")));
  });

  ipcMain.handle("desktop:save-provider-connection", async (
    _event,
    rawInput: unknown,
  ): Promise<DesktopState> => {
    options.connections.save(parseProviderConnection(rawInput));
    options.persist();
    return options.state(false);
  });

  ipcMain.handle("desktop:remove-provider-connection", async (
    _event,
    rawId: unknown,
  ): Promise<DesktopState> => {
    const id = parseId(rawId, "Provider connection");
    options.connections.remove(id);
    if (options.selected() === id) {
      options.select(options.connections.list().find((connection) => connection.enabled)?.id
        ?? OPENROUTER_CONNECTION_ID);
    }
    options.persist();
    return options.state(false);
  });
}

function parseProviderConnection(input: unknown): ProviderConnectionInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Provider connection must be an object");
  }
  const value = input as Record<string, unknown>;
  return {
    id: typeof value.id === "string" ? value.id : "",
    providerId: parseId(value.providerId, "Provider"),
    name: typeof value.name === "string" ? value.name : "",
    baseUrl: typeof value.baseUrl === "string" ? value.baseUrl : "",
    enabled: value.enabled !== false,
    requestLimit: Number.isInteger(value.requestLimit) && Number(value.requestLimit) >= 1 && Number(value.requestLimit) <= 16
      ? Number(value.requestLimit)
      : 1,
    fallbackProviderConnectionId: typeof value.fallbackProviderConnectionId === "string"
      ? value.fallbackProviderConnectionId
      : "",
    fallbackModel: typeof value.fallbackModel === "string" ? value.fallbackModel : "",
    manualModels: Array.isArray(value.manualModels)
      ? value.manualModels.map(parseProviderModel)
      : [],
    ...(typeof value.apiKey === "string" ? { apiKey: value.apiKey } : {}),
  };
}

function parseProviderModel(input: unknown): ProviderModel {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Invalid provider model");
  }
  const value = input as Record<string, unknown>;
  const id = parseId(value.id, "Model");
  return {
    id,
    name: typeof value.name === "string" && value.name.trim() ? value.name.trim() : id,
    contextLength: Number.isInteger(value.contextLength) && Number(value.contextLength) > 0
      ? Number(value.contextLength)
      : 128_000,
    inputModalities: Array.isArray(value.inputModalities)
      ? value.inputModalities.filter((item): item is string => typeof item === "string")
      : ["text"],
  };
}

function parseId(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) throw new Error(`${label} id must be a string`);
  return value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
