export type AttachmentKind = "image" | "document" | "pdf";
export type AttachmentDelivery = "image" | "markdown" | "pdf";

export type AttachmentRef = {
  id: string;
  name: string;
  mediaType: string;
  size: number;
  kind: AttachmentKind;
  delivery: AttachmentDelivery;
  estimatedTokens: number;
};

export type AttachmentPreview = AttachmentRef & {
  thumbnail?: string;
};

export type ResolvedAttachment =
  | { type: "image"; mediaType: string; data: string }
  | { type: "markdown"; text: string }
  | { type: "pdf"; data: string };

