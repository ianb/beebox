# print() in doctests

Verify that `print()` is available as a scope-local function in doctest blocks.

## Basic print

```
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

```
print("line 1");
print("line 2");
print("line 3")
=>
line 1
line 2
line 3
```

## Print accumulates across statements

Statements (`;`-terminated) can call print, and those lines appear in the next check.

```
for (let i = 1; i <= 3; i++) {
  print(`item ${i}`);
};
"end"
=>
item 1
item 2
item 3
end
```

## Print drains after each check

After an assertion, the print buffer resets.

```
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

```
print("result:");
({ status: "ok", count: 2 })
=>
result:
{
  "status": "ok",
  "count": 2
}
```

## No prints — normal behavior

When print isn't called, behavior is unchanged from before.

```
2 + 2
=> 4

"hello".toUpperCase()
=> HELLO
```
