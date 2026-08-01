import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { OpenAICompatibleProvider } from "../src/providers/openai-compatible.js";

test("OpenAI-compatible provider sends tools and normalizes a tool call", async (t) => {
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => (body += chunk));
    request.on("end", () => {
      const parsed = JSON.parse(body) as {
        model: string;
        stream: boolean;
        tools: unknown[];
      };

      assert.equal(request.url, "/v1/chat/completions");
      assert.equal(request.headers.authorization, "Bearer secret");
      assert.equal(parsed.model, "test-model");
      assert.equal(parsed.stream, true);
      assert.equal(parsed.tools.length, 1);

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
                      arguments: '{"path":"package.json"}',
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
    { id: "call-1", name: "read_file", input: { path: "package.json" } },
  ]);
  assert.deepEqual(result.usage, { inputTokens: 10, outputTokens: 5, totalTokens: 15 });
});

test("OpenAI-compatible provider streams text and assembles tool calls", async (t) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.write('data: {"choices":[{"delta":{"content":"Checking "}}]}\n\n');
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
  const deltas: string[] = [];
  const result = await provider.complete(
    [{ role: "user", content: "Inspect the project" }],
    [],
    new AbortController().signal,
    (text) => {
      deltas.push(text);
    },
  );

  assert.deepEqual(deltas, ["Checking ", "now."]);
  assert.equal(result.text, "Checking now.");
  assert.deepEqual(result.toolCalls, [
    { id: "call-1", name: "read_file", input: { path: "package.json" } },
  ]);
  assert.deepEqual(result.usage, { inputTokens: 10, outputTokens: 5, totalTokens: 15 });
});
