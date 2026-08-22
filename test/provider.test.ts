import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import {
  OpenAICompatibleProvider,
  listOpenAICompatibleModels,
} from "../src/providers/openai-compatible.js";
import { AnthropicMessagesProvider } from "../src/providers/anthropic-messages.js";
import {
  createProvider,
  providerCatalog,
  providerDefinitions,
  providerStatus,
} from "../src/providers/registry.js";
import { applyModelVariant, providerProfile, splitModelVariant } from "../src/providers/profiles.js";
import type { ModelStreamEvent } from "../src/providers/provider.js";
import { canRetryStatus, retryAfterMilliseconds, retryBackoffMs } from "../src/retry.js";

test("retry backoff stays short twice, then grows to 45 seconds", () => {
  assert.deepEqual([1, 2, 3, 4].map((retry) => retryBackoffMs(retry)), [500, 1_000, 15_000, 45_000]);
  assert.equal(retryBackoffMs(1, 30_000), 30_000);
  assert.equal(retryBackoffMs(1, 60_000), 45_000);
  assert.equal(retryAfterMilliseconds("12"), 12_000);
  assert.equal(retryAfterMilliseconds("invalid"), 0);
  assert.equal(canRetryStatus(400), false);
  assert.equal(canRetryStatus(429), true);
  assert.equal(canRetryStatus(500), true);
});

test("provider-declared model variants preserve the base model identity", () => {
  const variants = providerProfile("openrouter").modelVariants;

  assert.deepEqual(splitModelVariant("qwen/qwen3:nitro", variants), {
    baseModelId: "qwen/qwen3",
    variantId: "nitro",
    routable: true,
  });
  assert.equal(applyModelVariant("qwen/qwen3:nitro", "floor", variants), "qwen/qwen3:floor");
  assert.equal(applyModelVariant("qwen/qwen3:free", "exacto", variants), "qwen/qwen3:free");
});

test("local provider presets reuse the OpenAI-compatible runtime", () => {
  const expected = [
    ["llama-cpp", "http://localhost:8080/v1", "optional"],
    ["ollama", "http://localhost:11434/v1", "none"],
    ["lm-studio", "http://localhost:1234/v1", "none"],
    ["omlx", "http://localhost:8000/v1", "optional"],
    ["mlx-lm", "http://localhost:8080/v1", "none"],
    ["unsloth-studio", "http://localhost:8888/v1", "optional"],
  ];

  for (const [id, baseUrl, apiKey] of expected) {
    const profile = providerProfile(id!);
    assert.equal(profile.defaultBaseUrl, baseUrl);
    assert.equal(profile.apiKey, apiKey);
    assert.ok(providerDefinitions().some((definition) => definition.id === id));

    const provider = createProvider({
      id: `${id}-connection`,
      providerId: id!,
      name: profile.name,
      baseUrl: baseUrl!,
      enabled: true,
      requestLimit: 1,
      hasApiKey: false,
      manualModels: [],
    }, "local-model", {});
    assert.equal(provider.providerId, id);
    assert.equal(provider.model, "local-model");
  }
});

test("OpenCode Go discovers supported models and routes its two wire formats", async (t) => {
  const paths: string[] = [];
  const server = createServer((request, response) => {
    paths.push(request.url ?? "");
    if (request.url === "/models") {
      assert.equal(request.headers.authorization, "Bearer secret");
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        data: [
          { id: "deepseek-v4-flash" },
          { id: "minimax-m2.7" },
          { id: "gpt-5.6-luna" },
        ],
      }));
      return;
    }

    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => (body += chunk));
    request.on("end", () => {
      assert.ok(JSON.parse(body));
      response.writeHead(200, { "content-type": "application/json" });
      if (request.url === "/messages") {
        assert.equal(request.headers["x-api-key"], "secret");
        response.end(JSON.stringify({ content: [{ type: "text", text: "Messages" }] }));
      } else {
        assert.equal(request.headers.authorization, "Bearer secret");
        response.end(JSON.stringify({ choices: [{ message: { content: "Chat" } }] }));
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not start");
  const connection = {
    id: "opencode-go-test",
    providerId: "opencode-go",
    name: "OpenCode Go",
    baseUrl: `http://127.0.0.1:${address.port}`,
    enabled: true,
    requestLimit: 1,
    hasApiKey: true,
    apiKey: "secret",
    manualModels: [],
  };

  assert.equal(providerProfile("opencode-go").defaultBaseUrl, "https://opencode.ai/zen/go/v1");
  assert.equal(providerProfile("opencode-go").defaultRequestLimit, 8);
  const catalog = await providerCatalog(connection);
  assert.deepEqual(catalog.models.map((model) => model.id), ["deepseek-v4-flash", "minimax-m2.7"]);
  assert.equal(await createProvider(connection, "deepseek-v4-flash", {}).complete(
    [{ role: "user", content: "Hello" }], [], new AbortController().signal,
  ).then((result) => result.text), "Chat");
  assert.equal(await createProvider(connection, "minimax-m2.7", {}).complete(
    [{ role: "user", content: "Hello" }], [], new AbortController().signal,
  ).then((result) => result.text), "Messages");
  assert.deepEqual(paths, ["/models", "/chat/completions", "/messages"]);
});

test("OpenAI-compatible provider sends attachment content without storing payloads in messages", async (t) => {
  let content: unknown;
  let resolutions = 0;
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => (body += chunk));
    request.on("end", () => {
      content = (JSON.parse(body) as { messages: Array<{ content: unknown }> }).messages[0]?.content;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ choices: [{ message: { content: "Done" } }] }));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not start");

  const provider = new OpenAICompatibleProvider({
    baseUrl: `http://127.0.0.1:${address.port}`,
    model: "test-model",
    resolveAttachment: async () => {
      resolutions += 1;
      return { type: "image", mediaType: "image/png", data: "cG5n" };
    },
  });
  await provider.complete(
    [{
      role: "user",
      content: "Describe this",
      attachments: [{
        id: "00000000-0000-0000-0000-000000000000",
        name: "screen.png",
        mediaType: "image/png",
        size: 3,
        kind: "image",
        delivery: "image",
        estimatedTokens: 1500,
      }, {
        id: "00000000-0000-0000-0000-000000000001",
        name: "old-notes.md",
        mediaType: "text/markdown",
        size: 100,
        kind: "document",
        delivery: "markdown",
        estimatedTokens: 25,
        includeInContext: false,
      }],
    }],
    [],
    new AbortController().signal,
  );

  assert.deepEqual(content, [
    { type: "text", text: "Describe this" },
    { type: "image_url", image_url: { url: "data:image/png;base64,cG5n" } },
    { type: "text", text: '<attachment name="old-notes.md" available="false" />' },
  ]);
  assert.equal(resolutions, 1);
});

test("llama.cpp receives one leading system message and active reasoning_content", async (t) => {
  let messages: Array<Record<string, unknown>> = [];
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => (body += chunk));
    request.on("end", () => {
      messages = (JSON.parse(body) as { messages: Array<Record<string, unknown>> }).messages;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ choices: [{ message: { content: "Done" } }] }));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not start");

  const provider = new OpenAICompatibleProvider({
    baseUrl: `http://127.0.0.1:${address.port}`,
    model: "qwen",
    providerId: "llama-cpp",
  });
  await provider.complete([
    { role: "system", content: "Base instructions" },
    { role: "user", content: "Inspect the project" },
    { role: "system", content: "Current environment" },
    {
      role: "assistant",
      content: "",
      reasoning: "I should inspect package.json.",
      toolCalls: [{ id: "tool-1", name: "read_file", input: { path: "package.json" } }],
    },
    { role: "tool", toolCallId: "tool-1", content: "{}" },
  ], [], new AbortController().signal);

  assert.deepEqual(messages, [
    { role: "system", content: "Base instructions\n\nCurrent environment" },
    { role: "user", content: "Inspect the project" },
    {
      role: "assistant",
      content: null,
      reasoning_content: "I should inspect package.json.",
      tool_calls: [{
        id: "tool-1",
        type: "function",
        function: { name: "read_file", arguments: "{\"path\":\"package.json\"}" },
      }],
    },
    { role: "tool", tool_call_id: "tool-1", content: "{}" },
  ]);
});

test("Anthropic Messages preserves signed thinking through an active tool loop", async (t) => {
  const requests: Array<Record<string, unknown>> = [];
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => (body += chunk));
    request.on("end", () => {
      requests.push(JSON.parse(body) as Record<string, unknown>);
      if (requests.length === 1) {
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.write('data: {"type":"message_start","message":{"usage":{"input_tokens":5,"cache_read_input_tokens":3,"cache_creation_input_tokens":2}}}\n\n');
        response.write('data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":"","signature":""}}\n\n');
        response.write('data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"Inspect first. "}}\n\n');
        response.write('data: {"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"sig-123"}}\n\n');
        response.write('data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"tool-1","name":"read_file","input":{}}}\n\n');
        response.write('data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"path\\":\\"package.json\\"}"}}\n\n');
        response.write('data: {"type":"content_block_stop","index":1}\n\n');
        response.write('data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":4}}\n\n');
        response.end('data: {"type":"message_stop"}\n\n');
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        content: [{ type: "text", text: "Done" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 12, output_tokens: 1 },
      }));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not start");

  const provider = new AnthropicMessagesProvider({
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    model: "test-model",
    apiKey: "secret",
  });
  const first = await provider.complete(
    [{ role: "system", content: "Be concise." }, { role: "user", content: "Inspect the project" }],
    [{
      name: "read_file",
      description: "Read a workspace file",
      inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    }],
    new AbortController().signal,
  );

  assert.equal(first.reasoning, "Inspect first. ");
  assert.deepEqual(first.toolCalls, [
    { id: "tool-1", name: "read_file", input: { path: "package.json" } },
  ]);
  assert.deepEqual(first.usage, {
    inputTokens: 10,
    outputTokens: 4,
    totalTokens: 14,
    cachedInputTokens: 3,
  });
  assert.deepEqual(first.providerState, {
    anthropic: { thinking: [{ type: "thinking", thinking: "Inspect first. ", signature: "sig-123" }] },
  });

  await provider.complete(
    [
      { role: "system", content: "Be concise." },
      { role: "user", content: "Inspect the project" },
      {
        role: "assistant",
        content: first.text,
        reasoning: first.reasoning,
        toolCalls: first.toolCalls,
        providerState: first.providerState,
      },
      { role: "tool", toolCallId: "tool-1", content: "{}" },
    ],
    [],
    new AbortController().signal,
  );

  assert.equal(requests[0]?.system, "Be concise.");
  assert.deepEqual(requests[1]?.messages, [
    { role: "user", content: [{ type: "text", text: "Inspect the project" }] },
    {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "Inspect first. ", signature: "sig-123" },
        { type: "tool_use", id: "tool-1", name: "read_file", input: { path: "package.json" } },
      ],
    },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "tool-1", content: "{}" }] },
  ]);
});

test("OpenAI-compatible model discovery works for local or hosted connections", async (t) => {
  const server = createServer((request, response) => {
    assert.equal(request.url, "/v1/models");
    assert.equal(request.headers.authorization, "Bearer secret");
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      data: [{ id: "local/qwen", name: "Qwen Local", context_length: 262_144 }],
    }));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not start");

  assert.deepEqual(
    await listOpenAICompatibleModels(`http://127.0.0.1:${address.port}/v1`, "secret"),
    [{
      id: "local/qwen",
      name: "Qwen Local",
      contextLength: 262_144,
      inputModalities: ["text"],
    }],
  );
});

test("llama.cpp model discovery uses the active server context", async (t) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      data: [{ id: "qwen", meta: { n_ctx: 131_072, n_ctx_train: 262_144 } }],
    }));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not start");

  const catalog = await providerCatalog({
    id: "llama-test",
    providerId: "llama-cpp",
    name: "llama.cpp",
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    enabled: true,
    requestLimit: 1,
    hasApiKey: false,
    manualModels: [],
  });
  assert.equal(catalog.models[0]?.contextLength, 131_072);
});

test("a manual model can test successfully when discovery is unavailable", async (t) => {
  const server = createServer((request, response) => {
    if (request.url === "/v1/models") {
      response.writeHead(404).end();
      return;
    }

    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => (body += chunk));
    request.on("end", () => {
      const input = JSON.parse(body) as { model: string; max_tokens: number };
      assert.equal(request.url, "/v1/chat/completions");
      assert.equal(input.model, "manual-model");
      assert.equal(input.max_tokens, 1);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ choices: [{ message: { content: "OK" } }] }));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not start");

  assert.deepEqual(await providerStatus({
    id: "manual-provider",
    providerId: "openai-compatible",
    name: "Manual provider",
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    enabled: true,
    requestLimit: 1,
    hasApiKey: false,
    manualModels: [{
      id: "manual-model",
      name: "Manual model",
      contextLength: 128_000,
      inputModalities: ["text"],
    }],
  }), {
    message: "Connected",
    details: [
      { label: "Model", value: "Manual model" },
      { label: "Discovery", value: "Unavailable" },
    ],
  });
});

test("DeepSeek uses the shared model catalog and adds account balance", async (t) => {
  let chatRequest: Record<string, unknown> | undefined;
  const server = createServer((request, response) => {
    assert.equal(request.headers.authorization, "Bearer secret");
    if (request.url === "/chat/completions") {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk: string) => (body += chunk));
      request.on("end", () => {
        chatRequest = JSON.parse(body) as Record<string, unknown>;
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({
          choices: [{ message: { content: "Done" } }],
          usage: { prompt_tokens: 10, prompt_cache_hit_tokens: 6 },
        }));
      });
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(request.url === "/models"
      ? JSON.stringify({ data: [{ id: "deepseek-v4-flash", owned_by: "deepseek" }] })
      : JSON.stringify({
        is_available: true,
        balance_infos: [{ currency: "USD", total_balance: "12.50" }],
      }));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not start");
  const connection = {
    id: "deepseek-test",
    providerId: "deepseek",
    name: "DeepSeek",
    baseUrl: `http://127.0.0.1:${address.port}`,
    enabled: true,
    requestLimit: 1,
    hasApiKey: true,
    apiKey: "secret",
    manualModels: [],
  };

  const catalog = await providerCatalog(connection);
  assert.equal(catalog.models[0]?.id, "deepseek-v4-flash");
  assert.equal(catalog.discoveredModelCount, 1);
  assert.equal(catalog.models[0]?.contextLength, 1_000_000);
  assert.deepEqual(await providerStatus(connection), {
    message: "Connected",
    details: [{ label: "USD balance", value: "12.50" }],
  });
  const completion = await createProvider(connection, "deepseek-v4-flash", {}).complete(
    [{ role: "user", content: "Hello" }],
    [],
    new AbortController().signal,
  );
  assert.equal(chatRequest?.parallel_tool_calls, undefined);
  assert.equal(completion.usage?.cachedInputTokens, 6);
});

test("OpenAI-compatible provider repairs a common double-encoded tool call", async (t) => {
  let requestCount = 0;
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => (body += chunk));
    request.on("end", () => {
      const parsed = JSON.parse(body) as {
        model: string;
        messages: Array<{ role: string; content: string }>;
        parallel_tool_calls: boolean;
        max_tokens: number;
        stream: boolean;
        temperature?: number;
        seed?: number;
        tools: unknown[];
      };
      requestCount += 1;

      assert.equal(request.url, "/v1/chat/completions");
      assert.equal(request.headers.authorization, "Bearer secret");
      assert.equal(parsed.model, "test-model");
      assert.equal(parsed.parallel_tool_calls, false);
      assert.equal(parsed.max_tokens, 16_384);
      assert.equal(parsed.stream, true);
      assert.equal(parsed.temperature, 0);
      assert.equal(parsed.seed, 42);
      assert.equal(parsed.tools.length, 1);

      if (requestCount === 1) {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: "" } }] }));
        return;
      }

      assert.match(
        parsed.messages[0]?.content ?? "",
        /neither a final answer nor a tool call/,
      );

      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          choices: [
            {
              finish_reason: "tool_calls",
              message: {
                content: null,
                tool_calls: [
                  {
                    id: "call-1",
                    type: "function",
                    function: {
                      name: "read_file",
                      arguments: JSON.stringify('{"path":"package.json"]}'),
                    },
                  },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      );
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not start");

  const provider = new OpenAICompatibleProvider({
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    model: "test-model",
    apiKey: "secret",
    temperature: 0,
    seed: 42,
  });
  const result = await provider.complete(
    [{ role: "user", content: "Inspect the project" }],
    [
      {
        name: "read_file",
        description: "Read a file",
        inputSchema: { type: "object" },
      },
    ],
    new AbortController().signal,
  );

  assert.deepEqual(result.toolCalls, [
    {
      id: "call-1",
      name: "read_file",
      input: { path: "package.json" },
      inputRepair:
        "Arguments were sent as a quoted JSON string; converted them to a JSON object; The JSON ended with an extra ]; removed it",
    },
  ]);
  assert.deepEqual(result.usage, { inputTokens: 10, outputTokens: 5, totalTokens: 15 });
  assert.equal(requestCount, 2);
});

test("OpenAI-compatible provider streams text and assembles tool calls", async (t) => {
  let requestCount = 0;
  const server = createServer((_request, response) => {
    requestCount += 1;
    response.writeHead(200, { "content-type": "text/event-stream" });
    if (requestCount === 1) {
      response.write('data: {"choices":[{"delta":{"content":"Discard this partial answer."}}]}\n\n');
      response.write(
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"run_command","arguments":"{bad"}}]}}]}\n\n',
      );
      response.end(
        'data: {"error":{"code":502,"message":"Upstream error from Groq: Failed to parse tool call arguments as JSON","metadata":{"provider_name":"Groq","failed_generation":{"attempted_arguments":"{bad"}}}}\n\n',
      );
      return;
    }
    response.write('data: {"choices":[{"delta":{"content":"Checking "}}]}\n\n');
    response.write(
      'data: {"choices":[{"delta":{"reasoning_details":[{"type":"reasoning.text","text":"I should inspect the manifest. "}]}}]}\n\n',
    );
    response.write('data: {"choices":[{"delta":{"content":"now."}}]}\n\n');
    response.write(
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"read_file","arguments":"{\\"path\\":"}}]}}]}\n\n',
    );
    response.write(
      'data: {"choices":[{"finish_reason":"tool_calls","delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"package.json\\"}"}}]}}],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15,"cost":0.001,"prompt_tokens_details":{"cached_tokens":4},"completion_tokens_details":{"reasoning_tokens":2}}}\n\n',
    );
    response.end("data: [DONE]\n\n");
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not start");

  const provider = new OpenAICompatibleProvider({
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    model: "test-model",
    maxRetries: 2,
  });
  const events: ModelStreamEvent[] = [];
  const result = await provider.complete(
    [{ role: "user", content: "Inspect the project" }],
    [],
    new AbortController().signal,
    (event) => {
      events.push(event);
    },
  );

  assert.deepEqual(events, [
    { type: "text.delta", text: "Discard this partial answer." },
    { type: "tool.delta", index: 0, name: "run_command", argumentChars: 4 },
    {
      type: "retry",
      attempt: 1,
      maxRetries: 2,
      delayMs: 500,
      message:
        'Provider stream failed (502): Upstream error from Groq: Failed to parse tool call arguments as JSON\nProvider diagnostics: {"provider_name":"Groq","failed_generation":{"attempted_arguments":"{bad"}}; partial tool call: [{"name":"run_command","arguments":"{bad"}]',
    },
    { type: "text.delta", text: "Checking " },
    { type: "reasoning.delta", text: "I should inspect the manifest. " },
    { type: "text.delta", text: "now." },
    { type: "tool.delta", index: 0, name: "read_file", argumentChars: 8 },
  ]);
  assert.equal(result.text, "Checking now.");
  assert.equal(result.reasoning, "I should inspect the manifest. ");
  assert.equal(requestCount, 2);
  assert.deepEqual(result.toolCalls, [
    { id: "call-1", name: "read_file", input: { path: "package.json" } },
  ]);
  assert.deepEqual(result.usage, {
    inputTokens: 10,
    outputTokens: 5,
    totalTokens: 15,
    cachedInputTokens: 4,
    reasoningTokens: 2,
    costUsd: 0.001,
  });
});

test("OpenAI-compatible provider marks an abruptly closed stream incomplete", async (t) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.end('data: {"choices":[{"delta":{"content":"Partial response"}}]}\n\n');
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not start");

  const provider = new OpenAICompatibleProvider({
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    model: "test-model",
    maxRetries: 0,
  });
  const result = await provider.complete(
    [{ role: "user", content: "Answer" }],
    [],
    new AbortController().signal,
  );

  assert.equal(result.text, "Partial response");
  assert.equal(result.finishReason, "incomplete");
});
