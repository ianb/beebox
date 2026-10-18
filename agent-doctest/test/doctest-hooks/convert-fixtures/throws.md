# Throws

```ts setup
function fail(message: string): never {
  throw new TypeError(message);
}
```

Name only, name and message, and a message with a bare colon:

```ts
fail("x")
=> throws TypeError

fail("bad input")
=> throws TypeError: bad input

fail("a:b")
=> throws TypeError:«*»
```
