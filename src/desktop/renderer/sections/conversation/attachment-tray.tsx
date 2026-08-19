import type { AttachmentPreview, AttachmentRef } from "../../../../attachments/types.js";
import type { CSSProperties } from "react";

type DisplayAttachment = AttachmentRef & { thumbnail?: string };

export function AttachmentTray({
  activeAttachments,
  pendingAttachments,
  estimatedTokens,
  tooLarge,
  onRemoveActive,
  onRemovePending,
}: {
  activeAttachments: AttachmentRef[];
  pendingAttachments: AttachmentPreview[];
  estimatedTokens: number;
  tooLarge: boolean;
  onRemoveActive: (attachment: AttachmentRef) => void;
  onRemovePending: (attachment: AttachmentPreview) => void;
}): JSX.Element | null {
  const attachments: Array<{ attachment: DisplayAttachment; active: boolean }> = [
    ...activeAttachments
      .filter((attachment) => !isCodeReference(attachment.name))
      .map((attachment) => ({ attachment, active: true })),
    ...pendingAttachments.map((attachment) => ({ attachment, active: false })),
  ];
  if (!attachments.length) return null;
  const visible = attachments.slice(-4);
  const hidden = attachments.length - visible.length;
  const fanWidth = 112 + (visible.length - 1) * 34 + (hidden ? 34 : 8);

  return (
    <section className={`attachment-tray${tooLarge ? " too-large" : ""}`}>
      {visible.length ? <div className="attachment-fan" style={{ width: fanWidth }}>
        {visible.map(({ attachment, active }, index) => (
          <article
            className={active ? "attachment-card active" : "attachment-card"}
            key={attachment.id}
            style={{ "--attachment-index": index } as CSSProperties}
            title={active ? `${attachment.name} · in context` : attachment.name}
          >
            {attachment.thumbnail ? (
              <img src={attachment.thumbnail} alt="" />
            ) : (
              <span className="attachment-type">{fileLabel(attachment.name)}</span>
            )}
            {active ? <span className="attachment-state">Context</span> : null}
            <strong>{attachment.name}</strong>
            <button
              type="button"
              aria-label={active ? `Remove ${attachment.name} from context` : `Remove ${attachment.name}`}
              onClick={() => active
                ? onRemoveActive(attachment)
                : onRemovePending(attachment as AttachmentPreview)}
            >×</button>
          </article>
        ))}
        {hidden ? (
          <span className="attachment-more">+{hidden}</span>
        ) : null}
      </div> : null}
      <small>{tooLarge ? "Too large for this model" : `~${formatTokens(estimatedTokens)} tokens`}</small>
    </section>
  );
}

function fileLabel(name: string): string {
  if (isCodeReference(name)) return "CODE";
  const extension = name.split(".").pop();
  return extension && extension !== name ? extension.toUpperCase().slice(0, 5) : "FILE";
}

function isCodeReference(name: string): boolean {
  return name.includes(" · lines ") || / · \d+ selections$/.test(name);
}

function formatTokens(tokens: number): string {
  return tokens >= 1000 ? `${(tokens / 1000).toFixed(tokens >= 10_000 ? 0 : 1)}k` : String(tokens);
}
