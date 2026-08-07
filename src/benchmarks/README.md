# Benchmarks

Benchmarks must exercise the same agent, provider, context, tools, and execution boundaries used by the app. A benchmark-specific imitation may be useful for a narrow protocol experiment, but it does not measure the product harness.

This directory is the durable home for benchmark definitions, comparison runners, manifests, graders, and result reporting. Generated workspaces and results belong in ignored temporary or results directories.

## Harness comparison protocol

Use this protocol when comparing the product harness with Pi, OpenCode, or another coding harness.

### 1. Freeze the comparison

Record before starting:

- Harness names and exact versions or commits
- Product-harness commit and whether the working tree was dirty
- Model identifier and provider
- Prompt text
- Active tool names and complete schemas
- System-prompt or harness-instruction versions
- Context, turn, retry, timeout, and output limits
- Sampling and reasoning settings when configurable
- Runtime, operating system, architecture, and relevant dependency versions

Unknown values should be recorded as `unknown`, not omitted.

### 2. Match the capability surface

Expose equivalent tools in both harnesses. Comparing four tools in one harness with eight tools in the other is not a clean tool-protocol comparison, even when the extra tools are unused.

For the initial product-harness/Pi coding comparison, both sides used only:

| Product harness | Pi |
| --- | --- |
| `run_command` | `bash` |
| `read_file` | `read` |
| `edit_file` | `edit` |
| `write_file` | `write` |

Keep permissions and execution limits equivalent as well. Differences that cannot be removed must be stated with the results.

### 3. Start every attempt cleanly

- Create a new temporary workspace for every run.
- Copy only the declared fixture into it.
- Do not reuse model-authored files or tests from an earlier attempt.
- Alternate which harness runs first.
- Add a short cooldown between provider-backed runs when queueing or rate limits may contaminate the next result.
- Delete temporary workspaces in `finally` cleanup.
- After an interrupted batch, verify that no harness or benchmark child process remains alive.

Do not silently rerun a genuine task failure. Replace a run only when the runner or measurement was invalid, and record the reason for replacement.

### 4. Launch noninteractive harnesses correctly

A CLI that supports piped prompts may wait for standard-input EOF even when the prompt is also present in its arguments. When spawning a noninteractive child with a pipe for stdin, close it immediately:

```js
const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
child.stdin.end();
```

Leaving stdin open produced false Pi timeouts in the first comparison attempt. The model had not started; Pi was waiting for input to finish.

Capture stdout and stderr continuously. Track the first provider/model event and ongoing output activity, not only completed turns. A streaming turn can otherwise look like zero model calls until it ends.

### 5. Use activity-aware timeouts

A fixed short wall-clock timeout can kill healthy work in progress. Use:

- A bounded inactivity timeout reset by stdout, stderr, model, or tool activity
- A larger absolute safety timeout for a genuinely stuck process
- Explicit cancellation and descendant-process cleanup

The reference comparison used 180 seconds without activity and a 10-minute absolute cap. These are runner safeguards, not recommended product defaults.

### 6. Grade the requested behavior externally

Do not treat the model's own tests as the only correctness signal. Models vary in how many tests they write and how demanding those tests are.

Prefer fixed hidden acceptance tests or another external grader that:

- Is not visible in the prompt
- Checks the behavior the prompt actually requires
- Does not assume filenames or layout the prompt never specified
- Detects unrelated or destructive changes

One product-harness measurement was invalidated because the runner expected `counter/counter.py` and `counter/test_counter.py`, although the prompt required only a `counter/` folder. The validator was corrected and that measurement was transparently replaced.

### 7. Record enough metrics to explain the result

At minimum, retain per-run values for:

- External pass/fail and grader details
- Provider, harness, tool, and task failures as separate categories
- Input, cache-read, cache-write, output, and reasoning tokens when available
- Model turns and first-model-event latency
- Tool calls by tool
- Invalid tool inputs, healing, retries, and tool errors
- Command failures and timeouts
- Wall-clock duration and inactivity termination
- Files changed, patch size, and unrelated changes
- Provider-reported cost when available

Processed tokens are not the same as billed cost. Cached input may be substantially cheaper, and one harness may expose the cache split while another does not. Do not claim a cost advantage from processed-token totals alone.

### 8. Report variation, not only the best run

Use multiple non-seeded trials and show:

- Every valid per-run result
- Success rate
- Median and mean
- Outliers
- Any invalidated or replaced measurements and why

Median is useful for the typical run; mean exposes expensive outliers. Neither should be reported without correctness.

## Reference comparison: product harness and Pi

This was an exploratory five-run comparison performed on 2026-08-07. It is a reusable baseline, not a definitive statistical result.

### Configuration

- Model: `deepseek/deepseek-v4-flash-0731`
- Provider: OpenRouter
- Pi: `@earendil-works/pi-coding-agent@0.84.1`
- Runs: five fresh, non-seeded attempts per harness
- Order: alternated with a 30-second cooldown
- Tools: the matched four-tool surface listed above
- Timeout: 180 seconds of inactivity; 10-minute absolute safety cap
- Validation: external behavior checks plus generated-test inspection

Prompt:

```text
In a new `counter/` folder, build a small Python counter with tests.

Work in stages and complete and test each stage before starting the next:

1. Implement increment, decrement, and reset.
2. Add a configurable minimum value that the counter cannot go below.
3. Add undo support for the most recent operation.
4. Add JSON save and load support.

Run the tests after every stage and fix any failures. Do not implement later stages early.
```

### Aggregate result

Both harnesses completed all five valid runs.

| Metric | Product harness | Pi |
| --- | ---: | ---: |
| Median processed tokens | 52,183 | 77,623 |
| Mean processed tokens | 78,746.8 | 82,157.6 |
| Median input tokens | 46,973 | 72,925 |
| Median output tokens | 5,210 | 4,698 |
| Median model calls | 11 | 16 |
| Median tool calls | 14 | 16 |
| Median duration | 22.631 s | 22.595 s |
| Mean duration | 23.208 s | 24.691 s |
| Median generated tests | 21 | 19 |
| Total observed tool errors | 1 | 6 |

The product harness used 32.8% fewer processed tokens at the median. The mean advantage was only 4.2% because one run used 187,249 processed tokens. Runtime was effectively equal at the median. Pi exposed cached and uncached input separately while the product harness did not in this comparison, so these numbers do not establish an API-cost advantage.

### Per-run totals

| Harness | Run | Processed tokens | Model calls | Tool calls | Tool errors | Duration | Generated tests |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Product harness | 1 | 29,964 | 10 | 9 | 0 | 12.404 s | 17 |
| Product harness | 2 | 52,183 | 11 | 14 | 0 | 22.631 s | 21 |
| Product harness | 3 | 187,249 | 24 | 24 | 1 | 34.814 s | 22 |
| Product harness | 4 | 83,184 | 18 | 17 | 0 | 28.477 s | 21 |
| Product harness | 5 | 41,154 | 11 | 12 | 0 | 17.716 s | 19 |
| Pi | 1 | 77,623 | 16 | 16 | 1 | 22.595 s | 21 |
| Pi | 2 | 112,421 | 20 | 19 | 3 | 32.841 s | 19 |
| Pi | 3 | 64,956 | 14 | 14 | 0 | 20.416 s | 28 |
| Pi | 4 | 60,185 | 15 | 15 | 1 | 19.039 s | 14 |
| Pi | 5 | 95,603 | 19 | 18 | 1 | 28.566 s | 18 |

## Lessons for future runners

The comparison runner is part of the experiment and must be tested like any other measurement tool.

- Close stdin for noninteractive child processes.
- Observe live activity, not only completed-turn events.
- Prefer inactivity timeouts over a short fixed deadline.
- Alternate harness order and cool down provider-backed attempts.
- Match tools, permissions, and limits before comparing protocols.
- Validate requirements, not incidental filenames chosen by one harness.
- Use hidden tests; model-authored tests are useful evidence but not an independent grader.
- Separate provider failures from harness, tool, and task failures.
- Report cache usage separately when possible.
- Preserve high-cost outliers; they are important behavior, not noise to delete.
- Rerun only invalid measurements, never inconvenient genuine failures.
- Clean child processes and temporary workspaces even after interruption.

The first comparison scripts were prototypes stored outside the repository. Before treating the process as a repeatable project command, promote a small runner into this boundary, version its manifest format, and make the external grader part of the benchmark definition.
