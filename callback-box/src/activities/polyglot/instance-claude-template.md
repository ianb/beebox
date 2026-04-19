# {displayName}

Language-learning instance (activity: polyglot).

Instance state lives at `state.json`:

```json
{
  "language": "<language to learn>" | null,
  "level": "<beginner|elementary|intermediate|advanced|fluent>" | null,
  "createdAt": "<ISO timestamp>"
}
```

The `setup` mode exposes a `configure(language, level)` MCP tool — the
agent calls it once the user has settled on both fields, which writes
them to `state.json`. After that, `main` mode becomes available and
becomes the default entry mode.

`setup` stays available as a reconfigurator — calling `configure`
again overwrites the current values.
