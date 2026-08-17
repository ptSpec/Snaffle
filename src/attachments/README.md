# Attachments

This domain stores explicit message attachments and converts them into bounded provider payloads. It does not decide which conversation history is otherwise included in context.

## Start here

- `types.ts` defines persisted attachment references and extracted forms.
- `store.ts` stores originals and extracted Markdown outside ordinary message records.
- `vision.ts` creates payloads for vision-capable providers.

## Invariants

- Messages persist small references rather than large embedded documents.
- Originals and extracted content load only for an active request.
- Attachments are explicit user context and never silently truncated.
- The composer estimates their context cost and blocks sends when attachments alone would consume an unsafe share of the model window.
- Provider-specific OCR remains a replaceable fallback at this boundary.
