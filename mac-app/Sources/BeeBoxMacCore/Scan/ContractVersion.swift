/// The scan-upload wire contract's version, Swift spelling.
///
/// WIRE CONTRACT (scan-upload): must match docs/scan-upload-contract.md — change both sides together.
///
/// One number with three spellings: `beebox/src/core/scan/contract-version.ts`
/// (box), `scan-uploader/src/cli/contract-version.ts` (the Node uploader) and
/// this file (the Mac app). Bump all three in the same change, under the rules
/// in "When to bump" in the contract document. A bump reports a stale client;
/// it never refuses one.
public let scanContractVersion: Int = 1
