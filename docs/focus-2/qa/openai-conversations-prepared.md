> Registro histórico de preparación. Las ejecuciones posteriores y el estado actual están en [AI_OPENAI_IMPLEMENTATION.md](../AI_OPENAI_IMPLEMENTATION.md). Las afirmaciones de «pendiente» que siguen corresponden al momento de preparar este protocolo.

These are prepared fixtures, not executed provider results.

The five scenarios already existed in `tests/nova-battery/openai-conversations.json`. That file now includes four independent `runnerCase` payloads with synthetic events/tasks, explicit objective constraints, and a six-turn continuity contract. Existing human scores remain null.

The fixed clock is September 8, 2026 at 15:00 UTC, in `America/Santiago`. Tomorrow is September 9. The weekly plan explicitly covers September 14–20. The proposed day must allocate 180 minutes to Focus and 60 to gym, preserve football at 20:00, and start no new block before 09:00. The weekly plan must preserve classes, nightly sleep, and Friday/Saturday from 19:00, including intervals that cross those boundaries.

Run the four independent cases through the conversation wrapper. This invocation remains offline and needs no credentials:

```sh
node scripts/ai-conversation-benchmark.mjs \
  --base-url https://www.usefocus.me \
  --budget .50 \
  --report /tmp/focus-openai-conversations-independent.json
```

For a later authorized live run, the operator must add `--live`, choose the verified deployed origin, pass `--env-file` with the existing private Supabase environment, and add `--vercel-cli` if preview protection requires it. The wrapper fixes four synthetic users, four cases and the fixture clock; it rejects a budget above 0.50 USD. It delegates transport, the 0.25 USD per-request reservation, serial budget checks, replay and scoped account cleanup to the unchanged remote runner. The budget may stop the run before all four cases; unattempted cases remain unmeasured. Do not run alongside the 100-case benchmark. Do not change production quotas, route tier or billing to obtain a Sol result.

The existing grader still evaluates each `runnerCase.expect` without modification. The wrapper adds a separate `conversationChecks` result for measurable `objectiveChecks`: full interval overlap, exact total duration, fixed-event identity, duplicate prevention, action/proposal separation and missing requested allocations. Its constraint pass rate does not replace the original grader's verdict. Both remain visible in the report. Keyword matches are not a score for natural conversation or useful prioritization; those human scores remain null.

The weekly fixture is expected to select Sol under the local router. Actual Sol coverage requires a remote attempt row with `model = gpt-5.6-sol`; if economy mode or quotas downgrade it, report that Sol was not measured. Preserve usage-based versus conservative costs, attempt counts, replay counts and latency from the runner. No fixture or report implies that a client saved the plan.

The continuity scenario is excluded from this wrapper and assigned to a separate real web-client test. Its six turns must use the actual preceding responses and one UUID per logical turn; saving requires observed client receipts. Preserve the gym ID through the time edit, keep unapproved proposals separate, append actual assistant replies, and apply the final study cutoff to the pending plan. Never substitute expected outputs or six fabricated history snapshots and call that a completed conversation test. The JSON lists the initial synthetic state and the checks for every turn.

Offline validation: `node --test tests/ai-conversation-benchmark.test.js` passes 13 tests, including one call to the real runner's offline path. The other runner calls use mocks. No provider was invoked, no account was created, and no live outcome is recorded by this preparation.
