# Example doctest

This is a simple example showing how doctests work. Each fenced code block becomes a test case. Prose between blocks is ignored — use it to explain what you're testing.

## Basic assertions

Expressions followed by `=>` are checked against the expected value:

```
1 + 1
=> 2
```

String results are compared literally (no quotes needed):

```
"hello world".toUpperCase()
=> HELLO WORLD
```

## Multiple examples in one block

Examples in the same block share scope — variables persist between them:

```
const items = ["a", "b", "c"];
items.length
=> 3

items.join(", ")
=> a, b, c

items.reverse().join(", ")
=> c, b, a
```

## Setup blocks

Use `ts setup` blocks for imports and helpers shared across all tests in the file:

```ts setup
function greet(name) {
  return `Hello, ${name}!`;
}
```

```
greet("World")
=> Hello, World!
```

## Multi-line results

Use `=>` alone on a line, then the expected output continues until a blank line:

```
JSON.stringify({ name: "Alice", age: 30 }, null, 2)
=>
{
  "name": "Alice",
  "age": 30
}
```

## Statements and expressions

Lines ending with `;` are run as statements. The last non-semicolon expression is the one checked:

```
const numbers = [1, 2, 3, 4, 5];
const evens = numbers.filter(n => n % 2 === 0);
evens.join(" ")
=> 2 4
```

## No assertion — just run

Blocks without `=>` just verify the code doesn't throw:

```
const x = new Map();
x.set("key", "value");
```

## Continue blocks

Use `continue` to split a test across multiple blocks while sharing scope:

```
const counter = { value: 0 };
counter.value
=> 0
```

Increment and check again — same `counter` variable:

``` continue
counter.value += 1;
counter.value
=> 1
```

## The print() function

Each test gets a `print()` function. Printed lines drain into the next assertion:

```
print("step 1");
print("step 2");
"done"
=> step 1
step 2
done
```
