# Call Log — Service Interaction Recording

The `withCallLog` wrapper records every method call on a service object. This is how tests verify that code interacts with services correctly.

```ts setup
import { withCallLog, printCalls } from "../../src/services/call-log.js";
```

## Wrapping a service records calls

```ts
const svc = withCallLog({
  async greet(name) { return `hello ${name}`; },
  async add(a, b) { return a + b; },
});

await svc.greet("world");
await svc.add(2, 3);
svc.callLog.length
=> 2
```

```ts continue
printCalls(svc.callLog)
=>
greet("world")
add(2, 3)
```

## Filtering by method name

```ts
const svc = withCallLog({
  async send(to, msg) {},
  async receive() { return "msg"; },
});

await svc.send("alice", "hi");
await svc.receive();
await svc.send("bob", "hey");

printCalls(svc.callLog, "send")
=>
send("alice", "hi")
send("bob", "hey")
```

## Return values pass through

The wrapper doesn't change the return value — it just observes.

```ts
const svc = withCallLog({
  async double(n) { return n * 2; },
});

await svc.double(21)
=> 42
```

## Results are captured in the log

```ts
const svc = withCallLog({
  async double(n) { return n * 2; },
});

await svc.double(5);
svc.callLog[0].result
=> 10
```

## Non-function properties pass through

```ts
const svc = withCallLog({
  name: "test-service",
  async ping() { return "pong"; },
});

svc.name
=> test-service
```
