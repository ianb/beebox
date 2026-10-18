# Blocks

Setup runs once, at module level.

```ts setup
const base = 10;
```

## Adding

Adding one to the base:

```ts
base + 1
=> 11
```

A continue block shares the test's variables.

```ts
const doubled = base * 2;
doubled
=> 20
```

```ts continue
doubled + 1
=> 21
```

```json
{ "not": "code" }
```

Trailing prose.
