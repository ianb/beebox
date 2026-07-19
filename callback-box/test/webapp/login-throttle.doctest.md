# Login throttle (pure decision core, injected clock)

`src/webapp/login-throttle.ts` is a pure, in-memory throttle for the login and
setup POSTs. It never reads the clock itself — every time-dependent method takes
an injected `now` — so the whole backoff schedule is driven with plain integers.
Three independent limits: per-`(ip,email)` exponential backoff, a per-IP bucket
across all emails, and a global scrypt-concurrency cap. Both maps are
hard-capped (oldest-evicted) on top of a 1h expiry.

(`throttle`, not `t` — `t` is the tap test object each block already binds.)

```ts setup
import { LoginThrottle, CONCURRENCY_RETRY_MS } from "../../src/webapp/login-throttle.js";
```

## Backoff escalates per `(ip,email)` and clears on success

`min(1s · 2^(failures-1), 60s)`: one failure → 1s, two → 2s. A success wipes the
counters so the legitimate user is never throttled by their own earlier typos.

```ts
const throttle = new LoginThrottle();
const ip = "10.0.0.1";
const email = "user@example.com";
const t0 = 1_000_000;

// No history → allowed.
throttle.check({ ip, email, now: t0 }).allowed
=> true

// One failure → blocked for 1s.
throttle.recordFailure({ ip, email, now: t0 });
JSON.stringify(throttle.check({ ip, email, now: t0 }))
=> {"allowed":false,"retryAfterMs":1000}

// Two failures → 2s.
throttle.recordFailure({ ip, email, now: t0 });
throttle.check({ ip, email, now: t0 }).retryAfterMs
=> 2000

// Past the window → allowed again.
throttle.check({ ip, email, now: t0 + 2000 }).allowed
=> true

// Success clears the backoff — allowed immediately.
throttle.recordSuccess({ ip, email });
throttle.check({ ip, email, now: t0 }).allowed
=> true
```

## The per-IP bucket is independent of the email (varying email doesn't reset the clock)

```ts
const throttle = new LoginThrottle();
const ip = "10.0.0.9";
const t0 = 5_000_000;

// Fail against three DIFFERENT emails from the same IP.
throttle.recordFailure({ ip, email: "a@example.com", now: t0 });
throttle.recordFailure({ ip, email: "b@example.com", now: t0 });
throttle.recordFailure({ ip, email: "c@example.com", now: t0 });

// A brand-new email from that IP is already throttled — the per-IP bucket
// escalated to 3 failures (→ 4s) regardless of which email was tried.
JSON.stringify(throttle.check({ ip, email: "fresh@example.com", now: t0 }))
=> {"allowed":false,"retryAfterMs":4000}

// A different IP is untouched.
throttle.check({ ip: "10.0.0.10", email: "fresh@example.com", now: t0 }).allowed
=> true
```

## The per-email bucket is independent of the IP (a spoofed X-Forwarded-For doesn't reset the clock)

`trustProxy` makes `request.ip` attacker-controllable, so an (ip,email)- or
IP-only throttle is bypassable by rotating the forged IP. The per-email bucket
throttles a targeted account regardless of source IP.

```ts
const throttle = new LoginThrottle();
const email = "target@example.com";
const t0 = 7_000_000;

// Fail against the SAME email from three DIFFERENT (spoofed) IPs.
throttle.recordFailure({ ip: "10.0.0.1", email, now: t0 });
throttle.recordFailure({ ip: "10.0.0.2", email, now: t0 });
throttle.recordFailure({ ip: "10.0.0.3", email, now: t0 });

// A brand-new IP targeting that email is already throttled — the per-email
// bucket escalated to 3 failures (→ 4s) regardless of source IP.
JSON.stringify(throttle.check({ ip: "10.0.0.99", email, now: t0 }))
=> {"allowed":false,"retryAfterMs":4000}

// A different email from that fresh IP is untouched (neither its per-IP nor its
// per-email bucket has any history).
throttle.check({ ip: "10.0.0.99", email: "other@example.com", now: t0 }).allowed
=> true

// A success for the targeted email clears its per-email bucket too, so the real
// user isn't locked out by an attacker's failures against their address.
throttle.recordSuccess({ ip: "10.0.0.99", email });
throttle.check({ ip: "10.0.0.5", email, now: t0 }).allowed
=> true
```

## The global scrypt-concurrency cap refuses the 3rd concurrent verification

At most two verifications run at once; the excess caller is told to retry
BEFORE any hashing (each scrypt costs ~128MB / ~100ms).

```ts
const throttle = new LoginThrottle();

throttle.acquireHashSlot()
=> true

throttle.acquireHashSlot()
=> true

// Third concurrent verification is refused.
throttle.acquireHashSlot()
=> false

// Releasing one frees a slot.
throttle.releaseHashSlot();
throttle.acquireHashSlot()
=> true

CONCURRENCY_RETRY_MS
=> 500
```

## The maps are hard-capped (oldest-evicted), not just expiry-bounded

A spray of distinct `(ip,email)` keys can't grow the maps without bound — past
the cap the oldest entry is evicted (logged via `console.warn`, suppressed here).

```ts
const throttle = new LoginThrottle();
const origWarn = console.warn;
console.warn = function suppressed() { /* silence eviction warnings */ };
try {
  for (let i = 0; i < 4100; i++) {
    throttle.recordFailure({ ip: `10.1.${Math.floor(i / 256)}.${i % 256}`, email: `u${i}@example.com`, now: 1000 });
  }
} finally {
  console.warn = origWarn;
}

// 4100 distinct keys inserted, capped at 4000.
throttle.stats().keyEntries
=> 4000
```
