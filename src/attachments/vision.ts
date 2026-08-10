import type { Message } from "../protocol.js";
import type { ModelProvider } from "../providers/provider.js";
import type { AttachmentStore } from "./store.js";
import type { AttachmentRef } from "./types.js";

export type ImageUnderstandingProfile = {
  enabled: boolean;
  providerConnectionId: string;
  model: string;
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
  attachments: AttachmentStore;
  provider: ModelProvider;
  signal: AbortSignal;
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
      descriptions.set(attachment.id, cached ?? await describeImage(options, attachment));
    }
  }

  return options.messages.map((message) => {
    if (message.role !== "user" || !message.attachments?.some((item) => descriptions.has(item.id))) return message;
    const interpreted = message.attachments.flatMap((attachment) => {
      const description = descriptions.get(attachment.id);
      return description
        ? [`<image name=${JSON.stringify(attachment.name)} interpreted_by=${JSON.stringify(options.profile.model)}>\n${description}\n</image>`]
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
): Promise<string> {
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
  return description;
}
