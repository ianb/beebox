---
title: "`bbx create`'s key=value args parse JSON arrays but not JSON objects, so an object-typed template field can't be passed on the command line"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: main — production box feedback triage (bbx feedback)
priority: important
---

An agent ran `bbx create -t question ... learning='{"...": "..."}'` (the
command was spelled `callback`-era at the time; the behavior is unchanged) and got
`expected object, received string` from the template's `argsSchema`, even
though the value was valid JSON and the schema field is typed as an object. It
had to create the card with a placeholder value and then edit the field in
afterward — a two-step workaround for what should be a one-step create.

## Mechanism

`beebox/src/cli/commands/create.ts` parses each positional `key=value`
argument itself, before the value ever reaches the template's Zod
`argsSchema`. The parsing only special-cases arrays:

```
// Try JSON array parsing for values like '["a","b"]'
let value: unknown = raw;
if (raw.startsWith("[")) {
  try {
    value = JSON.parse(raw);
  } catch (_e) { ... }
}
```

(`create.ts`, in the `kvArgs` loop, roughly lines 97-104). A value starting
with `{` is never attempted as JSON — it stays a raw string — so any template
field typed as an object always fails Zod's `expected object, received
string` check, regardless of how well-formed the JSON is. Arrays work only
because someone added the one `[` case; objects were never added.

## Why the fix is not obvious

- The parser has no access to the target field's schema type when it decides
  whether to attempt JSON parsing, so it can't distinguish "this raw string
  legitimately starts with `{`" from "this is meant to be an object." The
  current design guesses from the first character; extending that guess to
  `{` is the minimal fix, but it also makes a string value that happens to
  start with `{` newly ambiguous (rare, but not impossible for a text field).
- An alternative is to parse every value against the field's schema type
  (looked up from the template) rather than sniffing the raw string, which is
  more correct but a larger change to how `kvArgs` are resolved into
  `parsedArgs`.
- Either way, a friendlier failure mode also matters: today the Zod error
  surfaces as a generic "expected object, received string" with no hint that
  the value needed to be object-parsed, so even an agent who suspects the
  cause has to reason it out from a generic message.
