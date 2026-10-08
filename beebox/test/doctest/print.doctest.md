# print() in doctests

Verify that `print()` is available as a scope-local function in doctest blocks.

## Basic print

```ts
print("hello");
print("world");
"done"
=>
hello
world
done
```

## Print with no return value

When the expression itself is `print(...)`, it returns undefined (excluded from output).

```ts
print("line 1");
print("line 2");
print("line 3")
=>
line 1
line 2
line 3
```

## Print drains after each check

After an assertion, the print buffer resets.

```ts
print("first");
"a"
=>
first
a

print("second");
"b"
=>
second
b
```

## Print with objects

Print lines are plain strings; the expression result is serialized normally.

```ts
print("result:");
({ status: "ok", count: 2 })
=>
result:
{
  "status": "ok",
  "count": 2
}
```
