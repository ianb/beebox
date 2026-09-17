/**
 * The wire contract's version, and the drift comparison over it.
 *
 * WIRE CONTRACT (scan-upload): must match docs/scan-upload-contract.md — change both sides together.
 *
 * A copied `scan-uploader.mjs` never updates itself and the box it uploads to
 * does, so a bundle can outlive the contract it was built against. A contract
 * change that breaks *parsing* already fails loudly — `wire-client.ts` throws
 * `ProtocolError` on an unknown state or an unexpected status. What does not
 * announce itself is a bundle whose parsing is fine but whose **client
 * obligations** are old: the settle gate and the restat-before-disposition
 * rules live only here, and they decide whether a scanned file is moved to the
 * Trash. This integer is what makes that observable.
 *
 * The comparison is deliberately a pure function over two numbers: it is the
 * part that has to be right, so it is the part that is doctest-reachable
 * without a server.
 */

/**
 * Bumped when a change alters what a correct client must **do** — the client
 * obligations, the state vocabulary, or a route's shape. NOT bumped for
 * server-internal changes a client cannot observe, and not for additive fields
 * that an older client correctly ignores.
 *
 * Nothing can test that a human bumped this, which makes a missed bump the one
 * failure worse than having no mechanism: it reports "current" for a bundle
 * that is genuinely stale. The mitigation is that the bump rides an existing
 * ritual rather than being a new obligation — the contract's own change
 * discipline already requires the doc, both implementations, and the doctests
 * to move in one change.
 */
export const SCAN_CONTRACT_VERSION = 1;

export type DriftVerdict =
  | { readonly kind: "current" }
  | { readonly kind: "client-behind"; readonly client: number; readonly server: number }
  | { readonly kind: "server-behind"; readonly client: number; readonly server: number }
  | { readonly kind: "unknown" };

/**
 * Compares this client's contract version against the box's.
 *
 * `server` is `undefined` for a box running code older than the version field
 * itself, which is every box until it deploys. That is a real state rather than
 * a defensive one, and it reports `unknown`: an old box is not evidence that
 * the client is wrong.
 */
export function compareContractVersion(params: {
  client: number;
  server: number | undefined;
}): DriftVerdict {
  const { client, server } = params;
  if (server === undefined) return { kind: "unknown" };
  if (server === client) return { kind: "current" };
  if (server > client) return { kind: "client-behind", client, server };
  return { kind: "server-behind", client, server };
}

/**
 * One line for stdout, or `undefined` when there is nothing to say.
 *
 * Both drift directions are reported, because naming which side is behind is
 * what keeps the reader from chasing the wrong one. `server-behind` is harmless
 * on its own — this client's obligations are stricter, not wrong — but it means
 * the box is the stale half, which is a different fix.
 */
export function describeDrift(verdict: DriftVerdict): string | undefined {
  switch (verdict.kind) {
    case "current":
    case "unknown":
      return undefined;
    case "client-behind":
      return (
        `scan-uploader speaks contract v${String(verdict.client)} but the box expects ` +
        `v${String(verdict.server)}. This uploader is out of date: uploads may still ` +
        "work, but its rules for when a scanned file is safe to move or delete are older " +
        "than the box's. Rebuild and re-copy dist/scan-uploader.mjs."
      );
    case "server-behind":
      return (
        `scan-uploader speaks contract v${String(verdict.client)} but the box expects ` +
        `v${String(verdict.server)}. The BOX is behind this uploader — deploy the box ` +
        "rather than changing the uploader."
      );
  }
}
