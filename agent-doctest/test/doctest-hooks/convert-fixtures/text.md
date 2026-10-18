# Text

Multi-line expected text with backticks, `${`, and backslashes:

```ts
"line `one`\n${x} \\ two"
=>
line `one`
${x} \ two
```

A multi-line expression with a trailing comment:

```ts
[1, 2,
  3].length // three
=> 3
```

A statement split by a blank line stays one statement:

```ts
const config = {
  a: 1,

  b: 2,
};
config.b
=> 2
```

A template literal's lines are not indented:

```ts
const s = `first
second`;
s
=> first
second
```
