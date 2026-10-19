// # Contract-version drift
//
// A copied `scan-uploader.mjs` never updates itself and the box it uploads to
// does, so a bundle can outlive the contract it was built against. A contract
// change that breaks *parsing* already fails loudly — `wire-client.ts` throws
// `ProtocolError` on an unknown state or an unexpected status. What this catches
// is the quieter case: a bundle whose parsing is fine but whose **client
// obligations** are old. The settle gate and the restat-before-disposition rules
// live only in the client, and they decide whether a scanned file is moved to the
// Trash.
//
// The comparison is a pure function over two numbers on purpose — it is the part
// that has to be right, so it is asserted here with no server in reach.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, str } from "@ianbicking/tap-check/check";
import { compareContractVersion, describeDrift, SCAN_CONTRACT_VERSION } from "../../src/cli/contract-version.js";

/** The verdict kind, plus the two versions when it carries them — the whole
 * observable result in one string. */
function verdict(params: { client: number; server: number | undefined }): string {
  const v = compareContractVersion(params);
  return v.kind === "current" || v.kind === "unknown" ? v.kind : `${v.kind} ${String(v.client)}→${String(v.server)}`;
}

// ## Matching versions say nothing
void test("Matching versions say nothing", async (t) => {
  // doctest:L29
  t.check(verdict({ client: 3, server: 3 }), "current");

  // doctest:L34
  t.check(describeDrift(compareContractVersion({ client: 3, server: 3 })), undefined);
});

// ## A box ahead of the client means the client is stale
//
// This is the case the mechanism exists for: the box deployed, the bundle on the
// laptop did not.
void test("This is the case the mechanism exists for:", async (t) => {
  // doctest:L44
  t.check(verdict({ client: 2, server: 3 }), "client-behind 2→3");

  // The message has to be actionable, and there is no update path to point at
  // except the manual one — nothing fetches the bundle and nothing self-updates —
  // so it names the rebuild rather than just the numbers:

  // doctest:L53
  t.check(describeDrift(compareContractVersion({ client: 2, server: 3 })), str`${any(String)}out of date${any(String)}Rebuild and re-copy dist/scan-uploader.mjs.`);

  // It also says what is actually at risk, since "out of date" alone does not
  // explain why anyone should care about a client that still uploads:

  // doctest:L61
  t.check(describeDrift(compareContractVersion({ client: 2, server: 3 })), str`${any(String)}rules for when a scanned file is safe to move or delete are older${any(String)}`);
});

// ## A client ahead of the box points at the box
//
// Real, and harmless on its own — this client's obligations are stricter, not
// wrong — but it is the *box* that needs deploying, and saying so keeps the
// reader from rebuilding the uploader over and over.
void test("Real, and harmless on its own — this client's obligations are stricter, not w...", async (t) => {
  // doctest:L72
  t.check(verdict({ client: 4, server: 3 }), "server-behind 4→3");

  // doctest:L77
  t.check(describeDrift(compareContractVersion({ client: 4, server: 3 })), str`${any(String)}The BOX is behind this uploader — deploy the box${any(String)}`);
});

// ## A box that reports no version is not evidence of drift
//
// Every box predates the version field until it deploys the code that sends it,
// so `undefined` is an ordinary state rather than a defensive one. Reporting
// drift here would fire on every box in the fleet the day this ships.
void test("Every box predates the version field until it deploys the code that sends it,...", async (t) => {
  // doctest:L88
  t.check(verdict({ client: 3, server: undefined }), "unknown");

  // doctest:L93
  t.check(describeDrift(compareContractVersion({ client: 3, server: undefined })), undefined);
});

// ## The shipped version is a positive integer
//
// Guards against the constant being edited into something that cannot be
// compared. Nothing can test that a human *bumped* it — that is the mechanism's
// one irreducible gap, documented at the constant — but its shape is checkable.
void test("Guards against the constant being edited into something that cannot be compared.", async (t) => {
  // doctest:L104
  t.check(`${String(Number.isInteger(SCAN_CONTRACT_VERSION))} ${String(SCAN_CONTRACT_VERSION > 0)}`, "true true");

  // A client compared against itself is always current, whatever the constant
  // becomes:

  // doctest:L112
  t.check(verdict({ client: SCAN_CONTRACT_VERSION, server: SCAN_CONTRACT_VERSION }), "current");
});
