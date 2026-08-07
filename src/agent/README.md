# Agent

`loop.ts` owns the model → tool → result loop. `trace.ts` records its observable events.

Keep provider translation, workspace enforcement, and UI state outside this folder. The loop should depend on their small interfaces instead.
