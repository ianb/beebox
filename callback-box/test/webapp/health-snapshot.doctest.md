# `health.check` serves a stale-while-revalidate snapshot

The deep health probes cost 580–650 ms (subprocess + git-annex doctor + a dozen
fs probes) and rode in the dashboard's tRPC batch, so every dashboard load
waited on them. `getHealthSnapshot` puts a per-box in-process snapshot in front:
a request never blocks on the probes except the very first one, and a snapshot
past its TTL is still answered instantly while a refresh runs behind the
request — so a newly broken or newly repaired box surfaces on the request after
that one, instead of going silent for the whole TTL.

`compute` and `now` are injected, so this exercises the caching contract without
running the real checks.

```ts setup
import { getHealthSnapshot, HEALTH_SNAPSHOT_TTL_MS } from "../../src/webapp/trpc/routers/health-snapshot.js";

const version = { deployedAt: null, commits: {}, processStartedAt: "2026-08-01T00:00:00Z", uptimeSec: 1 };

/** A compute that counts its runs and reports whatever `status` is set to. */
function makeProbe() {
  const probe = { runs: 0, status: "healthy" };
  const compute = async () => {
    probe.runs += 1;
    return { status: probe.status, checks: [], version };
  };
  return { probe, compute };
}

/** A compute whose every call hangs until the test resolves it by index. */
function makeGatedProbe() {
  const calls = [];
  const compute = () => new Promise((resolve, reject) => { calls.push({ resolve, reject }); });
  return { calls, compute };
}

const report = (status) => ({ status, checks: [], version });
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** `t.checkThrows` is sync-only, so async rejections are captured by hand. */
async function caught(fn) {
  try {
    await fn();
    return "(no error thrown)";
  } catch (e) {
    return `${e.name}: ${e.message}`;
  }
}

class ProbeExplodedError extends Error {
  constructor() {
    super("probe exploded");
    this.name = "ProbeExplodedError";
  }
}
```

## First call computes; calls within the TTL are free

```ts
const clock = { t: 1_000_000 };
const now = () => clock.t;
const { probe, compute } = makeProbe();
const box = "/tmp/box-ttl";

const first = await getHealthSnapshot(box, { compute, now });
`${first.status} runs=${String(probe.runs)}`
=> healthy runs=1

const second = await getHealthSnapshot(box, { compute, now });
`${second.status} runs=${String(probe.runs)}`
=> healthy runs=1
```

A break that happens inside the TTL window is not visible yet — that's the
deliberate trade:

```ts continue
probe.status = "unhealthy";
clock.t += HEALTH_SNAPSHOT_TTL_MS - 1;
const third = await getHealthSnapshot(box, { compute, now });
`${third.status} runs=${String(probe.runs)}`
=> healthy runs=1
```

## Past the TTL: the stale answer comes back immediately, refresh runs behind it

The request that finds the snapshot stale still gets the *old* report — it never
waits on the probes — but it starts the refresh, so the next caller sees truth.

```ts continue
clock.t += 2;
const stale = await getHealthSnapshot(box, { compute, now });
`${stale.status} runs=${String(probe.runs)}`
=> healthy runs=2

await new Promise((resolve) => setTimeout(resolve, 0));
const refreshed = await getHealthSnapshot(box, { compute, now });
`${refreshed.status} runs=${String(probe.runs)}`
=> unhealthy runs=2
```

## Concurrent cold callers compute once

```ts
const clock = { t: 5_000_000 };
const now = () => clock.t;
const { probe, compute } = makeProbe();
const box = "/tmp/box-concurrent";

const results = await Promise.all([
  getHealthSnapshot(box, { compute, now }),
  getHealthSnapshot(box, { compute, now }),
  getHealthSnapshot(box, { compute, now }),
]);
`${String(results.length)} callers, runs=${String(probe.runs)}`
=> 3 callers, runs=1
```

## `fresh: true` bypasses the cache entirely

This is the contract deploy runbooks depend on: `GET
/api/trpc/health.check?input={"fresh":true}` must reflect the box as it is right
now, not as it was up to a minute ago. (`cb health` and `/api/health` don't come
through here at all — they call `runHealthChecks` directly.)

```ts
const clock = { t: 9_000_000 };
const now = () => clock.t;
const { probe, compute } = makeProbe();
const box = "/tmp/box-fresh";

await getHealthSnapshot(box, { compute, now });
probe.status = "degraded";

const cached = await getHealthSnapshot(box, { compute, now });
`${cached.status} runs=${String(probe.runs)}`
=> healthy runs=1

const fresh = await getHealthSnapshot(box, { compute, now, fresh: true });
`${fresh.status} runs=${String(probe.runs)}`
=> degraded runs=2
```

A `fresh` run also re-seeds the snapshot, so the next cached read is current:

```ts continue
const afterFresh = await getHealthSnapshot(box, { compute, now });
`${afterFresh.status} runs=${String(probe.runs)}`
=> degraded runs=2
```

## A background refresh cannot overwrite a newer result

Snapshot writes are ordered by when each computation *started*, not when it
finished. Otherwise a background refresh that began before a `fresh: true` call
could land after it and re-poison the cache with the older verdict for the rest
of the TTL — precisely the window a deploy verifier reads. (Found by Codex
review, 2026-08-01.)

```ts
const clock = { t: 20_000_000 };
const now = () => clock.t;
const gated = makeGatedProbe();
const compute = gated.compute;
const box = "/tmp/box-race";

const cold = getHealthSnapshot(box, { compute, now });
gated.calls[0].resolve(report("healthy"));
(await cold).status
=> healthy
```

Age the snapshot out, then start a background refresh and leave it hanging:

```ts continue
clock.t += HEALTH_SNAPSHOT_TTL_MS + 1;
const stale = await getHealthSnapshot(box, { compute, now });
`${stale.status} computes=${String(gated.calls.length)}`
=> healthy computes=2
```

A `fresh` call now starts its own computation and finishes first:

```ts continue
const freshPromise = getHealthSnapshot(box, { compute, now, fresh: true });
gated.calls[2].resolve(report("degraded"));
(await freshPromise).status
=> degraded
```

Now the older background refresh finally lands with a *different* verdict. It
must not win:

```ts continue
gated.calls[1].resolve(report("unhealthy"));
await tick();
const after = await getHealthSnapshot(box, { compute, now });
`${after.status} computes=${String(gated.calls.length)}`
=> degraded computes=3
```

## A failed background refresh escalates to the foreground

If the refresh behind a stale read throws, the snapshot is no longer merely old
— its provenance is broken. Serving the last-known-good report forever behind a
log line would let a permanently broken health check read as healthy, so the
failure is latched and the next reader recomputes in the foreground and gets
the error.

```ts
const clock = { t: 30_000_000 };
const now = () => clock.t;
const mode = { status: "healthy", fail: false, runs: 0 };
const compute = async () => {
  mode.runs += 1;
  if (mode.fail) throw new ProbeExplodedError();
  return report(mode.status);
};
const box = "/tmp/box-refresh-fail";

(await getHealthSnapshot(box, { compute, now })).status
=> healthy

clock.t += HEALTH_SNAPSHOT_TTL_MS + 1;
mode.fail = true;
const stale = await getHealthSnapshot(box, { compute, now });
`${stale.status} runs=${String(mode.runs)}`
=> healthy runs=2
```

The next read no longer hides behind the snapshot:

```ts continue
await tick();
await caught(() => getHealthSnapshot(box, { compute, now }))
=> ProbeExplodedError: probe exploded
```

And a recovery clears the latch — back to normal cached service:

```ts continue
mode.fail = false;
mode.status = "degraded";
(await getHealthSnapshot(box, { compute, now })).status
=> degraded

mode.status = "unhealthy";
(await getHealthSnapshot(box, { compute, now })).status
=> degraded
```
