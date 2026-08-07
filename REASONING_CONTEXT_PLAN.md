# Reasoning context plan

This records the agreed direction for reasoning retention and replay. Implement it after the current attachment work is complete.

## Goal

Keep provider reasoning visible and durable for transparency without automatically paying its context cost on every later turn.

Reasoning storage and model context are separate concerns:

- Snaffle stores the complete reasoning trace in its local database.
- The UI continues to show stored reasoning with the run that produced it.
- Reasoning remains in model context while that run's tool loop is active.
- A later user turn may omit reasoning from completed runs without deleting it.

## Context behavior

```text
Snaffle database and UI
└── retain the complete visible reasoning trace

Active run and tool loop
└── replay reasoning needed to continue the current model response

Later user turn
├── omit completed-run plaintext reasoning when policy allows
└── preserve provider-required state when Automatic mode requires it
```

"Later user turn" begins only after the previous run has reached a final response, failure, cancellation, or another terminal state. Do not remove reasoning between tool calls within one active run.

## User setting

Add one setting named **Previous reasoning in context**:

1. **Automatic (recommended)**
   - Omit unnecessary plaintext reasoning from completed runs.
   - Preserve signed, encrypted, identified, or otherwise provider-required reasoning state.
   - Let the provider adapter decide based on capabilities it actually supports.

2. **Exclude after run**
   - Do not send completed-run reasoning on later user turns, including to remote providers.
   - Continue storing and displaying it in Snaffle.
   - Continue replaying it during the active tool loop.
   - Show a concise warning that some providers or models may lose continuity or reject the request.

3. **Always include**
   - Preserve and resend completed-run reasoning as part of later context.
   - This is the compatibility-first behavior and is useful for comparison or troubleshooting.

Do not classify behavior simply as local versus remote. The relevant distinction is whether the selected model and provider protocol require reasoning state to continue correctly. A user may still override Automatic mode for a remote provider by selecting Exclude after run.

## Provider boundary

The normalized provider response needs to distinguish:

- Plaintext reasoning shown to the user
- Opaque provider state such as signatures, encrypted payloads, or reasoning identifiers
- The assistant answer and tool calls

Do not place provider-specific fields in the agent core. Provider adapters should expose only the normalized reasoning information required for context construction and replay.

Automatic mode must be conservative when an adapter cannot determine whether opaque reasoning state is required. Exclude after run is an explicit user override and should be honored after showing the warning.

## Context projection

Keep the persisted conversation complete. Build a separate provider request projection for each turn:

1. Load the durable conversation and trace.
2. Identify the active run, completed runs, and terminal boundaries.
3. Apply the selected previous-reasoning policy.
4. Preserve ordinary assistant answers, user messages, tool calls, and bounded tool results.
5. Send the projected messages without mutating or deleting stored history.

This projection should be a small context-construction rule, not a second conversation model or a provider-specific orchestration framework.

## Transparency

The context inspector should eventually make the effect visible:

- Reasoning remains available in the transcript.
- A completed reasoning block can indicate that it was excluded from later model context.
- The run records which policy was active.
- Evaluation traces record the policy so token and quality comparisons remain reproducible.

## Verification

Before making Automatic the default, test representative models through each supported adapter:

- Multi-step tool loops still complete correctly.
- Follow-up turns retain the necessary conversational meaning.
- Providers requiring signed or encrypted reasoning state continue successfully.
- Exclude after run measurably reduces later input tokens.
- Stored reasoning remains readable after application restart.
- Switching among the three modes never deletes historical reasoning.

Compare correctness, provider failures, input and cached tokens, and follow-up quality. Token reduction alone is not a successful result if continuity becomes worse.

## Not part of the first implementation

- Reasoning summarization or semantic memory
- Different policies for every individual message
- Automatic model-specific heuristics outside provider capabilities
- Removing reasoning from Snaffle's database
- Stripping reasoning during an active tool loop
