import type { AttachmentPreview } from "../../attachments/types.js";
import type { CSSProperties } from "react";

export function AttachmentTray({
  attachments,
  estimatedTokens,
  tooLarge,
  onRemove,
}: {
  attachments: AttachmentPreview[];
  estimatedTokens: number;
  tooLarge: boolean;
  onRemove: (attachment: AttachmentPreview) => void;
}): JSX.Element | null {
  if (!attachments.length) return null;
  const visible = attachments.slice(0, 4);

  return (
    <section className={tooLarge ? "attachment-tray too-large" : "attachment-tray"}>
      <div className="attachment-fan">
        {visible.map((attachment, index) => (
          <article
            className="attachment-card"
            key={attachment.id}
            style={{ "--attachment-index": index } as CSSProperties}
            title={attachment.name}
          >
            {attachment.thumbnail ? (
              <img src={attachment.thumbnail} alt="" />
            ) : (
              <span className="attachment-type">{fileLabel(attachment.name)}</span>
            )}
            <strong>{attachment.name}</strong>
            <button type="button" aria-label={`Remove ${attachment.name}`} onClick={() => onRemove(attachment)}>×</button>
          </article>
        ))}
        {attachments.length > visible.length ? (
          <span className="attachment-more">+{attachments.length - visible.length}</span>
        ) : null}
      </div>
      <small>{tooLarge ? "Too large for this model" : `~${formatTokens(estimatedTokens)} tokens`}</small>
    </section>
  );
}

function fileLabel(name: string): string {
  const extension = name.split(".").pop();
  return extension && extension !== name ? extension.toUpperCase().slice(0, 5) : "FILE";
}

function formatTokens(tokens: number): string {
  return tokens >= 1000 ? `${(tokens / 1000).toFixed(tokens >= 10_000 ? 0 : 1)}k` : String(tokens);
}
