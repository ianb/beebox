/**
 * The scan-upload wire contract's version, box side.
 *
 * WIRE CONTRACT (scan-upload): must match docs/scan-upload-contract.md — change both sides together.
 *
 * Its twin is `scan-uploader/src/contract-version.ts`. The two share no code by
 * design — the uploader is a stand-alone package — so this constant exists in
 * two places and the contract doc is the coordination point.
 *
 * Bumped when a change alters what a correct client must **do**: the client
 * obligations (the settle gate, restat-before-disposition), the check-state
 * vocabulary, or a route's shape. NOT bumped for server-internal changes a
 * client cannot observe, and not for additive fields an older client correctly
 * ignores.
 *
 * Nothing can test that a human bumped it, which makes a missed bump the one
 * failure worse than having no mechanism: an uploader would be told it is
 * current when it is stale. The mitigation is that the bump rides the
 * contract's existing change discipline rather than being a new obligation.
 */
export const SCAN_CONTRACT_VERSION = 1;
