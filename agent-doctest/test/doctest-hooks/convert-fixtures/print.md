# Print and eventually

```ts
print("before");
1 + 1
=> before
2
```

```ts
let ready = false;
setTimeout(() => { ready = true; }, 5);
await eventually(() => ready)
=> true
```
