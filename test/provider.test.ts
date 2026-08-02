import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { OpenAICompatibleProvider } from "../src/providers/openai-compatible.js";
import type { ModelStreamEvent } from "../src/providers/provider.js";

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
        stream: boolean;
        tools: unknown[];
      };
      requestCount += 1;

      assert.equal(request.url, "/v1/chat/completions");
      assert.equal(request.headers.authorization, "Bearer secret");
      assert.equal(parsed.model, "test-model");
      assert.equal(parsed.parallel_tool_calls, false);
      assert.equal(parsed.stream, true);
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
      'data: {"choices":[{"finish_reason":"tool_calls","delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"package.json\\"}"}}]}}],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}\n\n',
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
  assert.deepEqual(result.usage, { inputTokens: 10, outputTokens: 5, totalTokens: 15 });
});
