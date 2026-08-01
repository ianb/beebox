/**
 * Orchestrates one sweep of one target folder: walk → settle gate → identity
 * snapshot → hash → batch check → PUT unknowns → restat-before-disposition.
 * See docs/scan-upload-contract.md "Client obligations" for the rules this
 * encodes.
 */

import { readFile } from "node:fs/promises";

import type { TargetConfig } from "./config.js";
import { applyDisposition } from "./disposition.js";
import { assertNever } from "./invariant.js";
import { identityEquals, snapshotIdentity, type FileIdentity } from "./identity.js";
import { sha256File } from "./hash.js";
import { isSettled } from "./settle.js";
import { sleep } from "./sleep.js";
import { TransportError } from "./errors.js";
import {
  CHECK_BATCH_LIMIT,
  checkHashes,
  putFile,
  type CheckResult,
  type PutResult,
  type ServerConnection,
} from "./wire-client.js";
import { listCandidateFiles } from "./walk.js";

export interface RunOptions {
  readonly retryRejected: boolean;
}

export interface RunSummary {
  readonly uploaded: number;
  readonly duplicate: number;
  readonly rejected: number;
  readonly skippedUnsettled: number;
  readonly skippedIdentityChanged: number;
  readonly errors: number;
}

interface Counters {
  uploaded: number;
  duplicate: number;
  rejected: number;
  skippedUnsettled: number;
  skippedIdentityChanged: number;
  errors: number;
}

interface Candidate {
  readonly filePath: string;
  readonly identity: FileIdentity;
  readonly hash: string;
}

const MAX_RATE_LIMIT_RETRIES = 5;

export async function runTarget(target: TargetConfig, options: RunOptions): Promise<RunSummary> {
  const connection = await readConnection(target);
  const counters: Counters = {
    uploaded: 0,
    duplicate: 0,
    rejected: 0,
    skippedUnsettled: 0,
    skippedIdentityChanged: 0,
    errors: 0,
  };

  const candidates = await collectCandidates(target.folder, counters);
  if (candidates.length === 0) {
    return { ...counters };
  }

  const checkStates = await checkAllHashes(connection, candidates.map((c) => c.hash));

  const ctx: ProcessContext = {
    connection,
    disposition: target.disposition,
    retryRejected: options.retryRejected,
    counters,
  };
  for (const candidate of candidates) {
    await processCandidate({ candidate, checkResult: checkStates.get(candidate.hash) }, ctx);
  }

  return { ...counters };
}

async function readConnection(target: TargetConfig): Promise<ServerConnection> {
  const token = (await readFile(target.tokenPath, "utf-8")).trim();
  return { serverUrl: target.serverUrl, box: target.box, token };
}

async function collectCandidates(folder: string, counters: Counters): Promise<Candidate[]> {
  const files = await listCandidateFiles(folder);
  const now = Date.now();
  const candidates: Candidate[] = [];
  for (const filePath of files) {
    if (!(await isSettled(filePath, now))) {
      console.log(`skipped-unsettled ${filePath}`);
      counters.skippedUnsettled += 1;
      continue;
    }
    // Identity is snapshotted before hashing, per the wire contract's client
    // obligations — hashing reads the whole file and takes real time, during
    // which the scanner could still touch it.
    const identity = await snapshotIdentity(filePath);
    const hash = await sha256File(filePath);
    candidates.push({ filePath, identity, hash });
  }
  return candidates;
}

async function checkAllHashes(
  connection: ServerConnection,
  hashes: readonly string[],
): Promise<Map<string, CheckResult>> {
  const unique = Array.from(new Set(hashes));
  const states = new Map<string, CheckResult>();
  for (const batch of chunk(unique, CHECK_BATCH_LIMIT)) {
    const batchStates = await checkHashes(connection, batch);
    for (const [hash, result] of batchStates) {
      states.set(hash, result);
    }
  }
  return states;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

interface ProcessContext {
  readonly connection: ServerConnection;
  readonly disposition: TargetConfig["disposition"];
  readonly retryRejected: boolean;
  readonly counters: Counters;
}

interface CandidateCheck {
  readonly candidate: Candidate;
  readonly checkResult: CheckResult | undefined;
}

async function processCandidate(item: CandidateCheck, ctx: ProcessContext): Promise<void> {
  const { candidate, checkResult } = item;
  const state = checkResult?.state ?? "unknown";

  if (state === "rejected" && !ctx.retryRejected) {
    console.log(`rejected ${candidate.filePath}: ${checkResult?.reason ?? "unknown reason"}`);
    ctx.counters.rejected += 1;
    return;
  }

  const isFreshUpload = await resolveConfirmation({ candidate, state }, ctx);
  if (isFreshUpload === undefined) {
    // Rejected on PUT, or a transport-level failure: already reported, never disposition.
    return;
  }

  if (isFreshUpload) {
    console.log(`uploaded ${candidate.filePath}`);
    ctx.counters.uploaded += 1;
  } else {
    console.log(`duplicate ${candidate.filePath}`);
    ctx.counters.duplicate += 1;
  }

  await dispositionIfUnchanged(candidate, ctx);
}

/** Resolves whether the file is confirmed on the server. Returns `true` for a
 * fresh accepted upload, `false` for an already-known file (duplicate/
 * pending/imported), or `undefined` if it was rejected or failed transport
 * (already reported to the counters; caller must not disposition). */
async function resolveConfirmation(
  params: { candidate: Candidate; state: CheckResult["state"] },
  ctx: ProcessContext,
): Promise<boolean | undefined> {
  const { candidate, state } = params;
  if (state === "pending" || state === "imported") {
    return false;
  }
  const result = await putWithRetry(ctx.connection, candidate);
  switch (result.status) {
    case "accepted":
      return true;
    case "duplicate":
      return false;
    case "rejected":
      console.log(`rejected ${candidate.filePath}: ${result.reason}`);
      ctx.counters.rejected += 1;
      return undefined;
    case "hash-mismatch":
      console.error(`error ${candidate.filePath}: hash mismatch on upload, will retry next run`);
      ctx.counters.errors += 1;
      return undefined;
    case "too-large":
      console.error(`error ${candidate.filePath}: file exceeds the server's size limit`);
      ctx.counters.errors += 1;
      return undefined;
    case "server-error":
      console.error(`error ${candidate.filePath}: server error, will retry next run: ${result.reason}`);
      ctx.counters.errors += 1;
      return undefined;
    default:
      return assertNever(result);
  }
}

async function dispositionIfUnchanged(candidate: Candidate, ctx: ProcessContext): Promise<void> {
  const current = await snapshotIdentity(candidate.filePath);
  if (!identityEquals(current, candidate.identity)) {
    console.log(`skipped-identity-changed ${candidate.filePath}`);
    ctx.counters.skippedIdentityChanged += 1;
    return;
  }
  await applyDisposition(candidate.filePath, ctx.disposition);
}

async function putWithRetry(
  connection: ServerConnection,
  candidate: Candidate,
): Promise<Exclude<PutResult, { status: "rate-limited" }>> {
  for (let attempt = 0; attempt < MAX_RATE_LIMIT_RETRIES; attempt += 1) {
    const result = await putFile(connection, { hash: candidate.hash, filePath: candidate.filePath });
    if (result.status !== "rate-limited") {
      return result;
    }
    await sleep(result.retryAfterSeconds * 1000);
  }
  throw new TransportError(
    connection.serverUrl,
    `rate limited on every attempt (${String(MAX_RATE_LIMIT_RETRIES)} retries) uploading ${candidate.filePath}`,
  );
}
