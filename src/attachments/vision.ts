import type { Message, Usage } from "../protocol.js";
import type { ModelProvider } from "../providers/provider.js";
import type { AttachmentRef } from "./types.js";

export type ImageUnderstandingProfile = {
  enabled: boolean;
  providerConnectionId: string;
  model: string;
};

export type ImageDescriptionStore = {
  imageDescription(id: string, connectionId: string, model: string): Promise<string | null>;
  saveImageDescription(id: string, connectionId: string, model: string, description: string): Promise<void>;
  imageInspection(id: string, connectionId: string, model: string, normalizedQuestion: string): Promise<string | null>;
  saveImageInspection(
    id: string,
    connectionId: string,
    model: string,
    normalizedQuestion: string,
    description: string,
  ): Promise<void>;
};

export type ImageUnderstandingActivity = {
  attachment: AttachmentRef;
  kind: "description" | "inspection";
  cached: boolean;
  model: string;
  providerId: string;
  providerConnectionId: string;
  usage?: Usage;
  durationMs?: number;
  question?: string;
};

export function imageUnderstandingProfile(value: unknown): ImageUnderstandingProfile {
  const input = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    enabled: input.enabled === true,
    providerConnectionId: typeof input.providerConnectionId === "string" ? input.providerConnectionId : "",
    model: typeof input.model === "string" ? input.model : "",
  };
}

export async function describeImages(options: {
  messages: Message[];
  profile: ImageUnderstandingProfile;
  attachments: ImageDescriptionStore;
  provider: ModelProvider;
  signal: AbortSignal;
  onActivity?: (activity: ImageUnderstandingActivity) => void;
}): Promise<Message[]> {
  const descriptions = new Map<string, string>();
  for (const message of options.messages) {
    if (message.role !== "user") continue;
    for (const attachment of message.attachments ?? []) {
      if (attachment.kind !== "image" || attachment.includeInContext === false || descriptions.has(attachment.id)) {
        continue;
      }
      const cached = await options.attachments.imageDescription(
        attachment.id,
        options.profile.providerConnectionId,
        options.profile.model,
      );
      const result = cached
        ? imageUnderstandingActivity(options, attachment, { description: cached, cached: true })
        : await describeImage(options, attachment);
      descriptions.set(attachment.id, result.description);
      const { description: _description, ...activity } = result;
      options.onActivity?.(activity);
    }
  }

  return options.messages.map((message) => {
    if (message.role !== "user" || !message.attachments?.some((item) => descriptions.has(item.id))) return message;
    const interpreted = message.attachments.flatMap((attachment) => {
      const description = descriptions.get(attachment.id);
      return description
        ? [`<image id=${JSON.stringify(attachment.id)} name=${JSON.stringify(attachment.name)} interpreted_by=${JSON.stringify(options.profile.model)} inspection_available="true">\n${description}\n</image>`]
        : [];
    });
    const attachments = message.attachments.filter((attachment) => !descriptions.has(attachment.id));
    const content = [message.content, ...interpreted].filter(Boolean).join("\n\n");
    if (attachments.length) return { ...message, content, attachments };
    const { attachments: _attachments, ...withoutAttachments } = message;
    return { ...withoutAttachments, content };
  });
}

async function describeImage(
  options: Parameters<typeof describeImages>[0],
  attachment: AttachmentRef,
): Promise<ImageUnderstandingActivity & { description: string }> {
  const startedAt = Date.now();
  const response = await options.provider.complete([
    {
      role: "user",
      content: [
        "Describe this image for another model that cannot see it.",
        "Transcribe visible text exactly, explain relevant layout and visual details, and state uncertainty plainly.",
        "Focus on details useful for the user's later request; do not answer that request yourself.",
      ].join(" "),
      attachments: [attachment],
    },
  ], [], options.signal);
  const description = response.text.trim();
  if (!description) throw new Error("The image-understanding model returned no description");
  await options.attachments.saveImageDescription(
    attachment.id,
    options.profile.providerConnectionId,
    options.profile.model,
    description,
  );
  return imageUnderstandingActivity(options, attachment, {
    description,
    cached: false,
    ...(response.usage ? { usage: response.usage } : {}),
    durationMs: Date.now() - startedAt,
  });
}

function imageUnderstandingActivity(
  options: Parameters<typeof describeImages>[0],
  attachment: AttachmentRef,
  details: { description: string; cached: boolean; usage?: Usage; durationMs?: number },
): ImageUnderstandingActivity & { description: string } {
  return {
    attachment,
    kind: "description",
    cached: details.cached,
    model: options.profile.model,
    providerId: options.provider.providerId,
    providerConnectionId: options.provider.connectionId,
    ...(details.usage ? { usage: details.usage } : {}),
    ...(details.durationMs === undefined ? {} : { durationMs: details.durationMs }),
    description: details.description,
  };
}
