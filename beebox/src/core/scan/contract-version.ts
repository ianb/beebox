/**
 * The scan-upload wire contract's version, box side.
 *
 * WIRE CONTRACT (scan-upload): must match docs/scan-upload-contract.md — change both sides together.
 *
 * Its twin is `mac-app/Sources/BeeBoxMacCore/Scan/ContractVersion.swift`. The
 * Mac app shares no code with the box, so this constant exists in two places
 * and the contract doc is the coordination point.
 *
 * Bumped when a change alters what a correct client must **do**: the client
 * obligations (the settle gate, restat-before-disposition), the check-state
 * vocabulary, or a route's shape. NOT bumped for server-internal changes a
 * client cannot observe, and not for additive fields an older client correctly
 * ignores.
 *
 * Nothing can test that a human bumped it. The bump rides the contract's
 * existing change discipline rather than being a new obligation.
 */
export const SCAN_CONTRACT_VERSION = 1;
