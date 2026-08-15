import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { nativeImage } from "electron";
import type { AttachmentDelivery, AttachmentKind, AttachmentPreview, AttachmentRef, ResolvedAttachment } from "./types.js";

export const MAX_ATTACHMENTS = 8;
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

const IMAGE_TYPES: Record<string, string> = {
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};
const TEXT_EXTENSIONS = new Set([".css", ".html", ".json", ".md", ".txt", ".xml", ".yaml", ".yml"]);
const DOCUMENT_EXTENSIONS = new Set([
  ".csv", ".doc", ".docm", ".docx", ".epub", ".odp", ".ods", ".odt", ".pdf",
  ".pot", ".pps", ".ppsm", ".ppsx", ".ppt", ".pptm", ".pptx", ".rtf", ".xls",
  ".xlsb", ".xlsm", ".xlsx",
]);

type ImageVisionCache = {
  connectionId?: unknown;
  model?: unknown;
  description?: unknown;
  analyses?: Array<{ question?: unknown; description?: unknown }>;
};

export class AttachmentStore {
  constructor(private readonly root: string) {}

  async importFiles(paths: string[]): Promise<AttachmentPreview[]> {
    if (paths.length > MAX_ATTACHMENTS) throw new Error(`Attach at most ${MAX_ATTACHMENTS} files at once`);
    return Promise.all(paths.map((filePath) => this.importFile(filePath)));
  }

  async importClipboardImage(bytes: Uint8Array): Promise<AttachmentPreview> {
    if (!bytes.length) throw new Error("The clipboard does not contain an image");
    if (bytes.length > MAX_ATTACHMENT_BYTES) throw new Error("The clipboard image is too large");
    const id = randomUUID();
    const folder = this.folder(id);
    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, "original"), bytes);
    const preview = thumbnail(bytes);
    return {
      id,
      fingerprint: fingerprint(bytes),
      name: "Pasted image.png",
      mediaType: "image/png",
      size: bytes.length,
      kind: "image",
      delivery: "image",
      estimatedTokens: 1500,
      ...(preview ? { thumbnail: preview } : {}),
    };
  }

  async importText(name: string, text: string): Promise<AttachmentPreview> {
    const id = randomUUID();
    const folder = this.folder(id);
    const bytes = Buffer.from(text);
    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, "original"), bytes);
    await writeFile(path.join(folder, "context.md"), text, "utf8");
    return {
      id,
      fingerprint: fingerprint(bytes),
      name,
      mediaType: "text/plain",
      size: bytes.length,
      kind: "document",
      delivery: "markdown",
      estimatedTokens: Math.max(1, Math.ceil(text.length / 4)),
    };
  }

  async remove(id: string): Promise<void> {
    await rm(this.folder(safeId(id)), { recursive: true, force: true });
  }

  async resolve(attachment: AttachmentRef): Promise<ResolvedAttachment> {
    const folder = this.folder(safeId(attachment.id));
    if (attachment.delivery === "markdown") {
      return { type: "markdown", text: await readFile(path.join(folder, "context.md"), "utf8") };
    }
    const data = (await readFile(path.join(folder, "original"))).toString("base64");
    return attachment.delivery === "image"
      ? { type: "image", mediaType: attachment.mediaType, data }
      : { type: "pdf", data };
  }

  async imageDescription(id: string, connectionId: string, model: string): Promise<string | null> {
    try {
      const value = await this.imageVisionCache(id);
      return value.connectionId === connectionId && value.model === model && typeof value.description === "string"
        ? value.description
        : null;
    } catch {
      return null;
    }
  }

  async saveImageDescription(id: string, connectionId: string, model: string, description: string): Promise<void> {
    const current = await this.imageVisionCache(id).catch((): ImageVisionCache => ({}));
    const analyses = current.connectionId === connectionId && current.model === model && Array.isArray(current.analyses)
      ? current.analyses
      : [];
    await writeFile(
      path.join(this.folder(safeId(id)), "vision.json"),
      JSON.stringify({ connectionId, model, description, analyses }),
      "utf8",
    );
  }

  async imageInspection(
    id: string,
    connectionId: string,
    model: string,
    normalizedQuestion: string,
  ): Promise<string | null> {
    try {
      const value = await this.imageVisionCache(id);
      if (value.connectionId !== connectionId || value.model !== model || !Array.isArray(value.analyses)) return null;
      const match = value.analyses.find((analysis) =>
        analysis && analysis.question === normalizedQuestion && typeof analysis.description === "string",
      );
      return typeof match?.description === "string" ? match.description : null;
    } catch {
      return null;
    }
  }

  async saveImageInspection(
    id: string,
    connectionId: string,
    model: string,
    normalizedQuestion: string,
    description: string,
  ): Promise<void> {
    const current = await this.imageVisionCache(id).catch((): ImageVisionCache => ({}));
    const analyses = current.connectionId === connectionId && current.model === model && Array.isArray(current.analyses)
      ? current.analyses.filter((analysis) => analysis.question !== normalizedQuestion)
      : [];
    analyses.push({ question: normalizedQuestion, description });
    await writeFile(
      path.join(this.folder(safeId(id)), "vision.json"),
      JSON.stringify({
        connectionId,
        model,
        ...(typeof current.description === "string" ? { description: current.description } : {}),
        analyses,
      }),
      "utf8",
    );
  }

  private async imageVisionCache(id: string): Promise<ImageVisionCache> {
    const value = JSON.parse(await readFile(path.join(this.folder(safeId(id)), "vision.json"), "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return value as ImageVisionCache;
  }

  private async importFile(filePath: string): Promise<AttachmentPreview> {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error(`${path.basename(filePath)} is not a file`);
    if (info.size > MAX_ATTACHMENT_BYTES) throw new Error(`${path.basename(filePath)} is larger than 20 MB`);

    const extension = path.extname(filePath).toLowerCase();
    const mediaType = IMAGE_TYPES[extension];
    if (!mediaType && !TEXT_EXTENSIONS.has(extension) && !DOCUMENT_EXTENSIONS.has(extension)) {
      throw new Error(`${path.basename(filePath)} is not a supported attachment`);
    }

    const id = randomUUID();
    const folder = this.folder(id);
    const bytes = await readFile(filePath);
    await mkdir(folder, { recursive: true });
    await copyFile(filePath, path.join(folder, "original"));

    if (mediaType) {
      const preview = thumbnail(bytes);
      return {
        id,
        fingerprint: fingerprint(bytes),
        name: path.basename(filePath),
        mediaType,
        size: info.size,
        kind: "image",
        delivery: "image",
        estimatedTokens: 1500,
        ...(preview ? { thumbnail: preview } : {}),
      };
    }

    const isPdf = extension === ".pdf";
    let markdown: string;
    try {
      markdown = TEXT_EXTENSIONS.has(extension)
        ? await readFile(filePath, "utf8")
        : await extractMarkdown(filePath);
    } catch (error) {
      if (!isPdf) throw error;
      markdown = "";
    }
    const usefulText = markdown.replace(/[#>*_`\s-]/g, "");
    const delivery: AttachmentDelivery = isPdf && usefulText.length < 80 ? "pdf" : "markdown";
    if (delivery === "markdown") await writeFile(path.join(folder, "context.md"), markdown, "utf8");

    return {
      id,
      fingerprint: fingerprint(bytes),
      name: path.basename(filePath),
      mediaType: isPdf ? "application/pdf" : "text/markdown",
      size: info.size,
      kind: isPdf ? "pdf" : "document",
      delivery,
      estimatedTokens: delivery === "markdown" ? Math.max(1, Math.ceil(markdown.length / 4)) : 8000,
    };
  }

  private folder(id: string): string {
    return path.join(this.root, id);
  }
}

function fingerprint(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function extractMarkdown(filePath: string): Promise<string> {
  const { toMarkdown } = await import("@firecrawl/anydoc");
  return toMarkdown(filePath);
}

function thumbnail(bytes: Uint8Array): string | undefined {
  const image = nativeImage.createFromBuffer(Buffer.from(bytes));
  if (image.isEmpty()) return undefined;
  const resized = image.resize({ width: 180, height: 120, quality: "good" });
  return `data:image/png;base64,${resized.toPNG().toString("base64")}`;
}

function safeId(id: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Invalid attachment id");
  return id;
}
