# Contract-version drift

A copied `scan-uploader.mjs` never updates itself and the box it uploads to
does, so a bundle can outlive the contract it was built against. A contract
change that breaks *parsing* already fails loudly — `wire-client.ts` throws
`ProtocolError` on an unknown state or an unexpected status. What this catches
is the quieter case: a bundle whose parsing is fine but whose **client
obligations** are old. The settle gate and the restat-before-disposition rules
live only in the client, and they decide whether a scanned file is moved to the
Trash.

The comparison is a pure function over two numbers on purpose — it is the part
that has to be right, so it is asserted here with no server in reach.

```ts setup
import { compareContractVersion, describeDrift, SCAN_CONTRACT_VERSION } from "../src/contract-version.js";

/** The verdict kind, plus the two versions when it carries them — the whole
 * observable result in one string. */
function verdict(params: { client: number; server: number | undefined }): string {
  const v = compareContractVersion(params);
  return v.kind === "current" || v.kind === "unknown" ? v.kind : `${v.kind} ${String(v.client)}→${String(v.server)}`;
}
```

## Matching versions say nothing

```
verdict({ client: 3, server: 3 })
=> current
```

```continue
describeDrift(compareContractVersion({ client: 3, server: 3 }))
=> undefined
```

## A box ahead of the client means the client is stale

This is the case the mechanism exists for: the box deployed, the bundle on the
laptop did not.

```
verdict({ client: 2, server: 3 })
=> client-behind 2→3
```

The message has to be actionable, and there is no update path to point at
except the manual one — nothing fetches the bundle and nothing self-updates —
so it names the rebuild rather than just the numbers:

```continue
describeDrift(compareContractVersion({ client: 2, server: 3 }))
=> «*»out of date«*»Rebuild and re-copy dist/scan-uploader.mjs.
```

It also says what is actually at risk, since "out of date" alone does not
explain why anyone should care about a client that still uploads:

```continue
describeDrift(compareContractVersion({ client: 2, server: 3 }))
=> «*»rules for when a scanned file is safe to move or delete are older«*»
```

## A client ahead of the box points at the box

Real, and harmless on its own — this client's obligations are stricter, not
wrong — but it is the *box* that needs deploying, and saying so keeps the
reader from rebuilding the uploader over and over.

```
verdict({ client: 4, server: 3 })
=> server-behind 4→3
```

```continue
describeDrift(compareContractVersion({ client: 4, server: 3 }))
=> «*»The BOX is behind this uploader — deploy the box«*»
```

## A box that reports no version is not evidence of drift

Every box predates the version field until it deploys the code that sends it,
so `undefined` is an ordinary state rather than a defensive one. Reporting
drift here would fire on every box in the fleet the day this ships.

```
verdict({ client: 3, server: undefined })
=> unknown
```

```continue
describeDrift(compareContractVersion({ client: 3, server: undefined }))
=> undefined
```

## The shipped version is a positive integer

Guards against the constant being edited into something that cannot be
compared. Nothing can test that a human *bumped* it — that is the mechanism's
one irreducible gap, documented at the constant — but its shape is checkable.

```
`${String(Number.isInteger(SCAN_CONTRACT_VERSION))} ${String(SCAN_CONTRACT_VERSION > 0)}`
=> true true
```

A client compared against itself is always current, whatever the constant
becomes:

```continue
verdict({ client: SCAN_CONTRACT_VERSION, server: SCAN_CONTRACT_VERSION })
=> current
```
