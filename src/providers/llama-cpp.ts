import {
  listOpenAICompatibleModels,
} from "./openai-compatible.js";
import {
  REASONING_EFFORTS,
  type ProviderModel,
  type ProviderStatus,
  type ResolvedProviderConnection,
} from "./provider.js";

const TOOL_SUPPORT_ERROR =
  "The loaded llama.cpp chat template does not support tool calls. Use a tool-capable Jinja template and ensure Jinja parsing is enabled.";

export async function listLlamaCppModels(
  connection: ResolvedProviderConnection,
  signal?: AbortSignal,
): Promise<ProviderModel[]> {
  return (await inspectLlamaCpp(connection, signal)).models;
}

export async function getLlamaCppStatus(
  connection: ResolvedProviderConnection,
  signal?: AbortSignal,
): Promise<ProviderStatus> {
  const inspection = await inspectLlamaCpp(connection, signal);
  const unavailable = inspection.models.find((model) => model.toolUseUnavailableReason);
  if (unavailable?.toolUseUnavailableReason) throw new Error(unavailable.toolUseUnavailableReason);

  const details: NonNullable<ProviderStatus["details"]> = [];
  if (inspection.models.length === 1) {
    details.push({ label: "Model", value: inspection.models[0]!.name });
  } else {
    details.push({ label: "Models", value: String(inspection.models.length) });
  }
  if (!inspection.props) {
    details.push({ label: "Capabilities", value: "Unavailable" });
    return { message: "Connected", details };
  }

  const contextLength = activeContextLength(inspection.props);
  const totalSlots = numberValue(inspection.props.total_slots);
  const build = stringValue(inspection.props.build_info);
  if (contextLength) details.push({ label: "Context", value: contextLength.toLocaleString("en-US") });
  if (totalSlots) details.push({ label: "Slots", value: String(totalSlots) });
  if (build) details.push({ label: "Build", value: build });
  return { message: "Connected", details };
}

async function inspectLlamaCpp(
  connection: ResolvedProviderConnection,
  signal?: AbortSignal,
): Promise<{ models: ProviderModel[]; props: Record<string, unknown> | null }> {
  let models: ProviderModel[];
  try {
    models = await listOpenAICompatibleModels(
      connection.baseUrl,
      connection.apiKey,
      signal,
      undefined,
      true,
    );
  } catch (error) {
    throw connectionError(error, connection.baseUrl);
  }

  if (models.length !== 1) return { models, props: null };
  let props: Record<string, unknown> | null = null;
  try {
    props = await readProps(connection, models[0]!.id, signal);
  } catch (error) {
    if (signal?.aborted) throw error;
  }
  return {
    models: props ? models.map((model) => applyProps(model, props)) : models,
    props,
  };
}

async function readProps(
  connection: ResolvedProviderConnection,
  model: string,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const url = propsUrl(connection.baseUrl, model);
  const response = await fetch(url, {
    headers: connection.apiKey ? { authorization: `Bearer ${connection.apiKey}` } : {},
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw new Error(`llama.cpp properties request failed (${response.status})`);
  const body: unknown = await response.json();
  const props = objectValue(body);
  if (!props) throw new Error("llama.cpp returned invalid server properties");
  return props;
}

function applyProps(model: ProviderModel, props: Record<string, unknown>): ProviderModel {
  const caps = objectValue(props.chat_template_caps);
  const modalities = objectValue(props.modalities);
  const toolsUnsupported = caps?.supports_tools === false || caps?.supports_tool_calls === false;
  const supportsImages = modalities?.vision === true && caps?.supports_typed_content !== false;
  const supportsReasoningEffort = caps?.supports_reasoning_effort === true;

  return {
    ...model,
    contextLength: activeContextLength(props) ?? model.contextLength,
    inputModalities: supportsImages ? ["text", "image"] : ["text"],
    ...(supportsReasoningEffort
      ? { reasoning: { efforts: [...REASONING_EFFORTS] } }
      : {}),
    ...(toolsUnsupported ? { toolUseUnavailableReason: TOOL_SUPPORT_ERROR } : {}),
  };
}

function propsUrl(baseUrl: string, model: string): URL {
  const url = new URL(baseUrl);
  url.pathname = `${url.pathname.replace(/\/v1\/?$/, "").replace(/\/$/, "")}/props`;
  url.search = "";
  url.hash = "";
  url.searchParams.set("model", model);
  url.searchParams.set("autoload", "false");
  return url;
}

function activeContextLength(props: Record<string, unknown>): number | undefined {
  return numberValue(objectValue(props.default_generation_settings)?.n_ctx);
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function connectionError(error: unknown, baseUrl: string): Error {
  if (!(error instanceof TypeError) || safePort(baseUrl) !== "8080") {
    return error instanceof Error ? error : new Error(String(error));
  }
  return new Error(
    `${error.message}. llama.cpp plans to move its default port from 8080 to 9931; use the address printed by llama-server.`,
    { cause: error },
  );
}

function safePort(value: string): string {
  try {
    return new URL(value).port;
  } catch {
    return "";
  }
}
