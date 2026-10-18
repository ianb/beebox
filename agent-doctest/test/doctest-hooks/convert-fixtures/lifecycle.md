# Lifecycle

```ts teardown
console.log("all done");
```

A cleanup before its test attaches to the next test.

```ts cleanup
console.log("cleanup one");
```

The test the cleanup belongs to.

```ts
const handle = { open: true };
handle.open
=> true
```

```ts continue cleanup
handle.open = false;
```
