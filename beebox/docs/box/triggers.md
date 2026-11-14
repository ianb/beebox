---
read-when: The person wants the box to react the moment they do something in a view or figure (build the right molecule, get stuck, finish a step) without typing; or a `<trigger>` message or `<triggers>` count appears in your chat.
---

# Activity triggers

A trigger is a TypeScript function in the box that reads what the person
does in a view or figure and decides whether to say something in the chat.
You write the file, arm it for the current chat with a config, and the
server evaluates it whenever the person's activity settles (and on a tick,
if the file asks for one). When it returns a result, the person sees the
text at once under the trigger's label, and you get a turn carrying the
text, a note, and the activity. Triggers expire by default.

## The file

`src/triggers/<name>.ts`, importing types from `beebox/triggers`:

```ts
import type { TriggerContext, TriggerInput, TriggerResult } from "beebox/triggers";

/** The person sees "Watching: Water check"; you disarm by this name or the id. */
export function label(config: unknown): string {
  return `Water check`;
}

/** Optional: also evaluate every N seconds while someone is present (at least 10). */
export const tick = 60;

export async function trigger(input: TriggerInput, ctx: TriggerContext): Promise<TriggerResult | null> {
  const last = input.entries.at(-1);
  if (last?.activity === undefined) return null;
  const molecules = (last.activity as { molecules?: string[] }).molecules ?? [];
  if (molecules.includes("H2O")) {
    return { text: "That's water. Two hydrogens, one oxygen.", note: `Correct after ${String(input.history.length)} actions.`, done: true };
  }
  if (input.reason === "tick" && input.sinceLastActivityMs !== null && input.sinceLastActivityMs > 4 * 60_000 && input.fires === 0) {
    return { text: "Try bonding the two hydrogens to the oxygen." };
  }
  return null;
}
```

What the function receives:

- `input.reason`: `"activity"` (new entries landed) or `"tick"`.
- `input.entries`: the chat's activity lines since the last evaluation,
  oldest first; empty on a tick with nothing new. Each line is what the
  view or figure logged: `card`, `kind`, `detail`, and the `activity`
  object (a figure's `activity(model)`, a view's third argument to
  `reportActivity`). A trigger sees only what the view or figure logged, so
  log the state a trigger would need, kept small.
- `input.history`: every line since arming (the most recent 500), so a
  fresh evaluation on a tick can still tell "stuck" from "done, then quiet".
- `input.sinceLastActivityMs`, `input.fires`, `input.lastFireAt`, `input.armedAt`.
- `ctx.config`: the JSON you passed at arm time. `ctx.log(message)` adds a
  line to the trace. `ctx.boxRoot` is the box.
- `ctx.judge(...)`: ask Jev. Either Jev's own shape
  (`{ instructions, questions: { name: { type: "noul" | "choice" | "score", instructions, criteria } }, state }`)
  or a judgment card (`{ card: "_content/checks/Water.judgment.card", state }`).
  Jev answers with probabilities, choices and scores; it writes no prose.
  Your function picks or fills in its own text from the answers. When the
  judge is unconfigured, over the daily budget, or fails, you get
  `{ kind: "unavailable", reason }` and decide what to do.

What it returns: `null` (nothing to say), or `{ text, note?, done? }`.
`text` is what the person sees (up to 2,000 characters); `note` is for you
only; `done: true` ends the activation after this fire. A second result
within 5 seconds of a fire is suppressed. The function runs in its own
process with a 20-second limit; a throw or a hang marks the activation
"not working" until an evaluation returns normally.

## Arming, watching, stopping

```sh
bbx chat trigger arm src/triggers/water-check.ts --config '{"target":"H2O"}'
bbx chat trigger arm src/triggers/stuck.ts --expires '{"minutes":30}'
bbx chat trigger arm src/triggers/always.ts --expires never
bbx chat trigger list
bbx chat trigger disarm "Water check"      # or the id, or --all
```

`arm` imports the file, calls `label(config)`, and writes the activation
for this chat. The default expiry is 20 of the person's turns or 2 hours,
whichever comes first; `--expires` sets one or both limits, and only the
word `never` removes them. The person's chat shows "Watching: Water check"
above the composer while it is armed, and "Water check: not working" when
the last evaluation failed. When the person says to stop watching, disarm
at once.

## When it fires

The person's chat shows the text under the label. Your next turn starts
with

```
<trigger label="Water check" file="src/triggers/water-check.ts" fire="1" entries="11" done="1">
<text>That's water. Two hydrogens, one oxygen.</text>
<note>Correct after 11 actions.</note>
</trigger>
```

The person has already read `<text>`: do not repeat it. Add something only
if it helps; otherwise `<ack kind="no-response"/>`. `bbx chat activity`
lists what the person did since their last message, including the actions
that fired it. Your chat snapshot carries `<triggers armed="N" failed="F"
expired="E"/>` while any activation is live or has something to tell you.

## Debugging

```sh
bbx chat trigger log                       # every evaluation: entries given, logs, judge calls, result
bbx chat trigger run src/triggers/water-check.ts --config '{"target":"H2O"}'
bbx chat activity --json > /tmp/replay.jsonl
bbx chat trigger run src/triggers/water-check.ts --activity /tmp/replay.jsonl --reason tick
```

`run` is a dry run through the same child the server uses: it evaluates,
delivers nothing, and prints the trace, so a wrong condition is found
without a person in front of the figure. `--activity` replays a JSONL
file of activity lines (what `bbx chat activity --json` prints);
`--since <seq>` splits it into history and new entries.

## Limits

- Triggers read the activity log, so they see what views and figures
  logged and nothing else: not the live state of a figure, not the page.
  If a trigger needs to know something, make the figure or view log it.
- Ticks run while anyone in the box has a tab open, not only this chat's
  person, until the activation expires.
- One evaluation per chat at a time; batches that land during one are
  evaluated next, nothing is skipped.
- Triggers run on the server with the box's library; they cannot reach the
  person's browser.
