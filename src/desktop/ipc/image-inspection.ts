import type { AttachmentRef } from "../../attachments/types.js";
import type {
  ImageDescriptionStore,
  ImageUnderstandingActivity,
  ImageUnderstandingProfile,
} from "../../attachments/vision.js";
import type { ModelProvider } from "../../providers/provider.js";
import { objectInput, stringField, ToolInputError, type Tool } from "../../tools/tool.js";

const MAX_FRESH_IMAGE_INSPECTIONS_PER_RUN = 2;

export function imageInspectionTool(options: {
  attachments: AttachmentRef[];
  profile: ImageUnderstandingProfile;
  attachmentStore: ImageDescriptionStore;
  provider: ModelProvider;
  signal: AbortSignal;
  onActivity?: (activity: ImageUnderstandingActivity) => void;
}): Tool {
  const images = new Map(options.attachments
    .filter((attachment) => attachment.kind === "image" && attachment.includeInContext !== false)
    .map((attachment) => [attachment.id, attachment]));
  let freshInspections = 0;

  return {
    name: "inspect_image",
    description:
      `Inspect an image already present in the conversation for a focused missing detail. ` +
      `Use the existing image description and prior tool results first. Call this only when the user asks about visual information that is absent or uncertain. ` +
      `Available image IDs: ${[...images.values()].map((attachment) => `${attachment.id} (${attachment.name})`).join(", ")}.`,
    exampleInput: {
      image_id: [...images.keys()][0] ?? "image-id",
      question: "Read the legend on the third chart exactly.",
    },
    inputErrorHint: "Use an image_id from an <image> block in the conversation and a precise visual question.",
    inputSchema: {
      type: "object",
      properties: {
        image_id: { type: "string", description: "Required. Image ID from the conversation's <image> block." },
        question: { type: "string", description: "Required. Specific visual detail to inspect." },
      },
      required: ["image_id", "question"],
      additionalProperties: false,
    },
    async execute(_workspace, rawInput) {
      const input = objectInput(rawInput);
      const imageId = stringField(input, "image_id") as string;
      const question = stringField(input, "question") as string;
      const attachment = images.get(imageId);
      if (!attachment) throw new ToolInputError("image_id must reference an image in the active conversation context");
      const normalizedQuestion = normalizeImageInspectionQuestion(question);
      if (normalizedQuestion.length < 8) {
        throw new ToolInputError("question must ask for a specific visual detail using at least 8 characters");
      }
      if (normalizedQuestion.length > 1_000) {
        throw new ToolInputError("question must be at most 1000 characters");
      }

      const cached = await options.attachmentStore.imageInspection(
        attachment.id,
        options.profile.providerConnectionId,
        options.profile.model,
        normalizedQuestion,
      );
      if (cached) {
        options.onActivity?.(imageInspectionActivity(options, attachment, question, { cached: true, output: cached }));
        return { content: imageInspectionContent(attachment, cached, true) };
      }
      if (freshInspections >= MAX_FRESH_IMAGE_INSPECTIONS_PER_RUN) {
        throw new Error(`Reached the ${MAX_FRESH_IMAGE_INSPECTIONS_PER_RUN}-image inspection limit for this run`);
      }
      freshInspections += 1;

      const startedAt = Date.now();
      const response = await options.provider.complete([
        {
          role: "user",
          content: [
            "Answer this focused question about the attached image for another model.",
            "Use only visible evidence. Quote text exactly where requested, distinguish uncertainty, and answer the question directly.",
            `Question: ${question.trim()}`,
          ].join(" "),
          attachments: [attachment],
        },
      ], [], options.signal);
      const description = response.text.trim();
      if (!description) throw new Error("The image-understanding model returned no inspection result");
      await options.attachmentStore.saveImageInspection(
        attachment.id,
        options.profile.providerConnectionId,
        options.profile.model,
        normalizedQuestion,
        description,
      );
      options.onActivity?.(imageInspectionActivity(
        options,
        attachment,
        question,
        {
          cached: false,
          output: description,
          ...(response.usage ? { usage: response.usage } : {}),
          durationMs: Date.now() - startedAt,
        },
      ));
      return { content: imageInspectionContent(attachment, description, false) };
    },
  };
}

function imageInspectionActivity(
  options: Parameters<typeof imageInspectionTool>[0],
  attachment: AttachmentRef,
  question: string,
  details: { cached: boolean; output: string; usage?: ImageUnderstandingActivity["usage"]; durationMs?: number },
): ImageUnderstandingActivity {
  return {
    attachment,
    kind: "inspection",
    cached: details.cached,
    model: options.profile.model,
    providerId: options.provider.providerId,
    providerConnectionId: options.provider.connectionId,
    output: details.output,
    question: question.trim(),
    ...(details.usage ? { usage: details.usage } : {}),
    ...(details.durationMs === undefined ? {} : { durationMs: details.durationMs }),
  };
}

export function normalizeImageInspectionQuestion(question: string): string {
  return question.trim().toLowerCase().replace(/\s+/g, " ");
}

function imageInspectionContent(attachment: AttachmentRef, description: string, cached: boolean): string {
  return [
    `Focused image inspection for ${JSON.stringify(attachment.name)}${cached ? " (cached)" : ""}:`,
    description,
  ].join("\n\n");
}
