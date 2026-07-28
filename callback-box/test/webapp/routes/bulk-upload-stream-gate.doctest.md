# Bulk-upload concurrent-stream gate

`beginStream`/`endStream` bound how many streaming uploads a single session can
have in flight at once, and refuse a second concurrent stream for the same item —
a cheap guard against a client opening dozens of parallel streams that each pass
the pre-commit byte check and jointly overshoot the staging cap.

```ts setup
import { beginStream, endStream } from "../../../src/webapp/routes/bulk-upload-stream-gate.js";
```

## A second concurrent stream for the same item is refused

```ts
const first = beginStream("s1", "item-a");
const again = beginStream("s1", "item-a");
JSON.stringify({ first, again })
=> {"first":"ok","again":"duplicate"}
```

Releasing the slot lets the same item stream again (a genuine retry after the
first finished):

```ts continue
endStream("s1", "item-a");
beginStream("s1", "item-a")
=> ok
```

```ts cleanup
endStream("s1", "item-a");
```

## The per-session concurrent-stream cap (8) refuses the 9th

Eight distinct items can stream at once; a ninth is refused until one releases:

```ts
const codes = [];
for (let i = 0; i < 9; i++) codes.push(beginStream("s2", `item-${String(i)}`));
JSON.stringify({ firstEight: codes.slice(0, 8), ninth: codes[8] })
=> {"firstEight":["ok","ok","ok","ok","ok","ok","ok","ok"],"ninth":"too-many"}
```

Releasing one frees exactly one slot:

```ts continue
endStream("s2", "item-0");
const afterRelease = beginStream("s2", "item-8");
JSON.stringify({ afterRelease })
=> {"afterRelease":"ok"}
```

```ts cleanup
for (let i = 1; i < 9; i++) endStream("s2", `item-${String(i)}`);
```

## Sessions are counted independently

A second session has its own budget — one session's in-flight streams don't
count against another's:

```ts
beginStream("s3", "x");
const otherSession = beginStream("s4", "x");
JSON.stringify({ otherSession })
=> {"otherSession":"ok"}
```

```ts cleanup
endStream("s3", "x");
endStream("s4", "x");
```
