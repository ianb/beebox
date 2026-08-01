# `health.check` serves a stale-while-revalidate snapshot

The deep health probes cost 580–650 ms (subprocess + git-annex doctor + a dozen
fs probes) and rode in the dashboard's tRPC batch, so every dashboard load
waited on them. `getHealthSnapshot` puts a per-box in-process snapshot in front:
a request never blocks on the probes except the very first one, and a snapshot
past its TTL is still answered instantly while a refresh runs behind the
request — so a newly broken or newly repaired box surfaces within one refresh
cycle instead of going silent for the whole TTL.

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
