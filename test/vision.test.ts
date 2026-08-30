import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { describeImages, type ImageUnderstandingActivity } from "../src/attachments/vision.js";
import { imageInspectionTool } from "../src/desktop/ipc/image-inspection.js";
import type { AttachmentRef } from "../src/attachments/types.js";
import type { ImageDescriptionStore } from "../src/attachments/vision.js";
import { LocalWorkspace } from "../src/execution/workspace.js";
import type { ModelProvider } from "../src/providers/provider.js";
import type { Message, ModelResponse, ToolSpec } from "../src/protocol.js";

const profile = {
  enabled: true,
  providerConnectionId: "vision-connection",
  model: "vision-model",
};

const image: AttachmentRef = {
  id: "image-1",
  name: "dashboard.png",
  mediaType: "image/png",
  size: 1,
  kind: "image",
  delivery: "image",
  estimatedTokens: 1500,
};

class VisionProvider implements ModelProvider {
  readonly model = profile.model;
  readonly providerId = "test";
  readonly connectionId = profile.providerConnectionId;
  calls = 0;
  messages: Message[][] = [];

  async complete(messages: Message[], _tools: ToolSpec[], _signal: AbortSignal): Promise<ModelResponse> {
    this.calls += 1;
    this.messages.push(messages);
    return {
      text: `inspection ${this.calls}`,
      toolCalls: [],
      usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12, cachedInputTokens: 4 },
    };
  }
}

class MemoryImageStore implements ImageDescriptionStore {
  private base: string | null = null;
  private readonly inspections = new Map<string, string>();

  async imageDescription(): Promise<string | null> {
    return this.base;
  }

  async saveImageDescription(_id: string, _connectionId: string, _model: string, description: string): Promise<void> {
    this.base = description;
  }

  async imageInspection(_id: string, _connectionId: string, _model: string, question: string): Promise<string | null> {
    return this.inspections.get(question) ?? null;
  }

  async saveImageInspection(
    _id: string,
    _connectionId: string,
    _model: string,
    question: string,
    description: string,
  ): Promise<void> {
    this.inspections.set(question, description);
  }
}

async function fixture(t: test.TestContext): Promise<{ root: string; store: MemoryImageStore; workspace: LocalWorkspace }> {
  const root = await mkdtemp(path.join(tmpdir(), "vision-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, store: new MemoryImageStore(), workspace: new LocalWorkspace(root, "disabled") };
}

test("image descriptions identify inspectable images and targeted inspections use the normalized cache", async (t) => {
  const { store, workspace } = await fixture(t);
  const provider = new VisionProvider();
  const activities: ImageUnderstandingActivity[] = [];
  const projected = await describeImages({
    messages: [{ role: "user", content: "What is shown?", attachments: [image] }],
    request: "What is shown?",
    profile,
    attachments: store,
    provider,
    signal: new AbortController().signal,
    onActivity: (activity) => activities.push(activity),
  });

  assert.match(projected[0]?.content ?? "", /<image id="image-1"/);
  assert.equal(provider.calls, 1);
  assert.match(provider.messages[0]?.[0]?.content ?? "", /visual evidence extractor/);
  assert.match(provider.messages[0]?.[0]?.content ?? "", /User request \(context only\): "What is shown\?"/);
  assert.deepEqual(activities, [{
    attachment: image,
    kind: "description",
    cached: false,
    model: profile.model,
    providerId: provider.providerId,
    providerConnectionId: provider.connectionId,
    output: "inspection 1",
    usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12, cachedInputTokens: 4 },
    durationMs: activities[0]?.durationMs,
  }]);

  await describeImages({
    messages: [{ role: "user", content: "What is shown?", attachments: [image] }],
    request: "What is shown?",
    profile,
    attachments: store,
    provider,
    signal: new AbortController().signal,
    onActivity: (activity) => activities.push(activity),
  });
  assert.equal(provider.calls, 1);
  assert.equal(activities[1]?.cached, true);
  assert.equal(activities[1]?.output, "inspection 1");
  assert.equal(activities[1]?.usage, undefined);

  const tool = imageInspectionTool({
    attachments: [image],
    profile,
    attachmentStore: store,
    provider,
    signal: new AbortController().signal,
    onActivity: (activity) => activities.push(activity),
  });
  const first = await tool.execute(workspace, {
    image_id: image.id,
    question: "Read the legend on the third chart exactly.",
  });
  assert.match(first.content, /inspection 2/);
  assert.equal(provider.calls, 2);
  assert.equal(activities[2]?.kind, "inspection");
  assert.equal(activities[2]?.cached, false);
  assert.equal(activities[2]?.output, "inspection 2");
  assert.deepEqual(activities[2]?.usage, { inputTokens: 10, outputTokens: 2, totalTokens: 12, cachedInputTokens: 4 });

  const cached = await tool.execute(workspace, {
    image_id: image.id,
    question: "  READ the legend on the third chart exactly.  ",
  });
  assert.match(cached.content, /cached/);
  assert.match(cached.content, /inspection 2/);
  assert.equal(provider.calls, 2);
  assert.equal(activities[3]?.cached, true);
  assert.equal(activities[3]?.output, "inspection 2");
  assert.equal(activities[3]?.usage, undefined);
});

test("automatic image evidence is cached per user request", async (t) => {
  const { store } = await fixture(t);
  const provider = new VisionProvider();
  const describe = (request: string) => describeImages({
    messages: [{ role: "user" as const, content: request, attachments: [image] }],
    request,
    profile,
    attachments: store,
    provider,
    signal: new AbortController().signal,
  });

  await describe("What color is the status indicator?");
  await describe("What color is the status indicator?");
  await describe("Read the error message exactly.");

  assert.equal(provider.calls, 2);
  assert.match(provider.messages[1]?.[0]?.content ?? "", /Read the error message exactly/);
});

test("image inspection rejects unrelated images and limits fresh calls per run", async (t) => {
  const { store, workspace } = await fixture(t);
  const provider = new VisionProvider();
  const tool = imageInspectionTool({
    attachments: [image],
    profile,
    attachmentStore: store,
    provider,
    signal: new AbortController().signal,
  });

  await assert.rejects(
    tool.execute(workspace, { image_id: "not-in-context", question: "Read the title exactly." }),
    /active conversation context/,
  );
  await assert.rejects(
    tool.execute(workspace, { image_id: image.id, question: "look" }),
    /specific visual detail/,
  );

  await tool.execute(workspace, { image_id: image.id, question: "Read the first chart title exactly." });
  await tool.execute(workspace, { image_id: image.id, question: "Read the second chart title exactly." });
  await assert.rejects(
    tool.execute(workspace, { image_id: image.id, question: "Read the third chart title exactly." }),
    /inspection limit/,
  );
  assert.equal(provider.calls, 2);
});
