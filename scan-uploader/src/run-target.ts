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
  /**
   * The subset of `rejected` the server refused in *this* run's PUT, as
   * opposed to the ones the `check` endpoint reported from a previous run.
   *
   * A rejected file is left in place on purpose and the server remembers its
   * hash, so `rejected` stays at 1 on every sweep from then on. This counter
   * is the one run that actually learns the file was refused, which is what
   * `notify.ts` needs to report a rejection once instead of every 15 minutes.
   *
   * "Newly" is judged against the pre-PUT check state, not against the PUT
   * outcome alone: `--retry-rejected` re-PUTs a rejection the server already
   * remembers, and a settle retry re-walks the whole folder in the same sweep,
   * so a PUT-time refusal is not by itself evidence that anything was learned.
   */
  readonly rejectedOnUpload: number;
  readonly skippedUnsettled: number;
  readonly skippedIdentityChanged: number;
  readonly errors: number;
  /**
   * The contract version this box reported, or `undefined` if it reported none
   * (a box predating the field) or if the sweep never reached the server —
   * a folder with nothing settled in it makes no request at all.
   *
   * An observation rather than a count, which is why it rides the summary: the
   * sweep is the only thing that talks to the box, and `cli.ts` is where the
   * comparison belongs.
   */
  readonly contractVersion: number | undefined;
}

interface Counters {
  uploaded: number;
  duplicate: number;
  rejected: number;
  rejectedOnUpload: number;
  skippedUnsettled: number;
  skippedIdentityChanged: number;
  errors: number;
  contractVersion: number | undefined;
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
    rejectedOnUpload: 0,
    skippedUnsettled: 0,
    skippedIdentityChanged: 0,
    errors: 0,
    contractVersion: undefined,
  };

  const candidates = await collectCandidates(target.folder, counters);
  if (candidates.length === 0) {
    return { ...counters };
  }

  const checked = await checkAllHashes(connection, candidates.map((c) => c.hash));
  const checkStates = checked.states;
  counters.contractVersion = checked.contractVersion;

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
): Promise<{ states: Map<string, CheckResult>; contractVersion: number | undefined }> {
  const unique = Array.from(new Set(hashes));
  const states = new Map<string, CheckResult>();
  // Every batch goes to the same box, so the version is whatever the last
  // response said — they cannot disagree unless the box was redeployed
  // mid-sweep, in which case the newest answer is the right one.
  let contractVersion: number | undefined;
  for (const batch of chunk(unique, CHECK_BATCH_LIMIT)) {
    const response = await checkHashes(connection, batch);
    for (const [hash, result] of response.states) {
      states.set(hash, result);
    }
    contractVersion = response.contractVersion ?? contractVersion;
  }
  return { states, contractVersion };
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
      // Newly learned only if the server did not already know. Under
      // `--retry-rejected` a remembered rejection is re-PUT and refused again,
      // which is the same fact a second time — and a settle retry re-walks the
      // folder, so counting it here would report one file as two.
      if (state !== "rejected") ctx.counters.rejectedOnUpload += 1;
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
