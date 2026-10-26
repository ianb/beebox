/**
 * The box screen's `quickChat.home` answer, left for the hub when the box goes
 * to sleep, so the phone gets the box's own last list without waking it
 * (docs/plans/ios-box-screen-stale-list.md, Track 2).
 *
 * `bbx serve` writes it at a clean shutdown (an idle exit or a SIGTERM) and
 * deletes it first thing at startup, so it exists only while the box sleeps.
 * The hub reads it the way it reads `hub-meta.json` (`core/hub-meta.ts`): by
 * path, through the 0751 directories that file's writer sets. Unlike that file
 * it holds box content (chat titles), so it is encrypted with AES-256-GCM
 * under a key both sides derive from the box's hub secret; another user on the
 * host who can read the 0644 file learns nothing. It also carries the token
 * hashes of the devices whose pairer could open the box at shutdown: the box
 * checks a pairer's membership on every request, and the hub, which cannot,
 * serves the snapshot only to those, and only while the member list the box
 * publishes in `hub-meta.json` is the one it had at shutdown: a member removed
 * by a hand edit while the box sleeps reaches the scheduler's republish, and
 * the hub then stops serving the snapshot. A host reboot regenerates the
 * hub secrets (`hub/secrets.ts`), so an older snapshot then fails to decrypt
 * and the hub takes its ordinary path.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import { writeFileAtomicSync } from "../../../lib/atomic-write.js";
import { getBoxTimeISO } from "../../../lib/time.js";
import { errnoCode, errorMessage } from "../../../shared/error-guards.js";
import { computeHubMeta } from "../../hub-meta.js";
import { mobileTokenHashesWithAccess } from "../../mobile/request-auth.js";
import { quickChatHome, quickChatHomeSchema, type QuickChatHome } from "./quick-chat-home.js";

const SNAPSHOT_RELATIVE_PATH = ".beebox/quick-chat-home.snapshot.json";
const KEY_INFO_PREFIX = "beebox quick-chat home snapshot v1 ";
/** A shutdown waits at most this long for the home; a later answer is not written. */
const SHUTDOWN_DEADLINE_MS = 5_000;

const envelopeSchema = z.strictObject({ v: z.literal(1), iv: z.string(), tag: z.string(), data: z.string() });
const plaintextSchema = z.strictObject({
  savedAt: z.string(), home: quickChatHomeSchema, deviceTokenHashes: z.array(z.string()), allowedEmails: z.array(z.string()),
});

export interface HomeSnapshot {
  savedAt: string;
  home: QuickChatHome;
  /** SHA-256 of each mobile device token the hub may serve this snapshot to. */
  deviceTokenHashes: string[];
  /** The box's published member list at shutdown (`hub-meta.json`'s `allowedEmails`). */
  allowedEmails: string[];
}

function snapshotPath(boxRoot: string): string {
  return path.join(boxRoot, SNAPSHOT_RELATIVE_PATH);
}

/** The slug keeps one box's key from opening another's under a hub that gives every child one secret. */
function snapshotKey(hubSecret: string, slug: string): Buffer {
  return Buffer.from(crypto.hkdfSync("sha256", hubSecret, "", `${KEY_INFO_PREFIX}${slug}`, 32));
}

export function writeHomeSnapshot(boxRoot: string, opts: { slug: string; hubSecret: string; snapshot: HomeSnapshot }): void {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", snapshotKey(opts.hubSecret, opts.slug), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(opts.snapshot), "utf8"), cipher.final()]);
  const envelope = { v: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") };
  writeFileAtomicSync(snapshotPath(boxRoot), { content: `${JSON.stringify(envelope)}\n`, mode: 0o644 });
}

/** Startup's first step. Anything but "already absent" throws: a kept snapshot would be served after this box changes. */
export function removeHomeSnapshot(boxRoot: string): void {
  fs.rmSync(snapshotPath(boxRoot), { force: true });
}

/**
 * The hub's read. Undefined when absent; also undefined, with a warning, when
 * the file is malformed or does not open under this secret (a rebooted host,
 * a restarted spawning hub).
 */
export function readHomeSnapshot(boxRoot: string, opts: { slug: string; hubSecret: string }): HomeSnapshot | undefined {
  let raw: string;
  try {
    raw = fs.readFileSync(snapshotPath(boxRoot), "utf8");
  } catch (e) {
    if (errnoCode(e) !== "ENOENT") console.warn(`[home-snapshot] cannot read ${snapshotPath(boxRoot)}: ${errorMessage(e)}`);
    return undefined;
  }
  try {
    const envelope = envelopeSchema.parse(JSON.parse(raw));
    const decipher = crypto.createDecipheriv("aes-256-gcm", snapshotKey(opts.hubSecret, opts.slug), Buffer.from(envelope.iv, "base64"));
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.data, "base64")), decipher.final()]).toString("utf8");
    return plaintextSchema.parse(JSON.parse(plaintext));
  } catch (e) {
    console.warn(`[home-snapshot] ${snapshotPath(boxRoot)} is malformed or not for this hub secret; ignoring it: ${errorMessage(e)}`);
    return undefined;
  }
}

/**
 * At a clean shutdown, after the server stopped taking requests: compute and
 * write each box's home when this box runs under a hub (`BBX_HUB_SECRET`).
 * Never throws into the shutdown; a failure or a late answer leaves no
 * snapshot, and the hub then takes its ordinary path.
 */
export async function writeHomeSnapshotsAtShutdown(boxes: readonly { slug: string; boxRoot: string }[], hubSecret: string | undefined): Promise<void> {
  if (hubSecret === undefined || hubSecret === "") return;
  await Promise.allSettled(boxes.map(async (box) => {
    let timer: NodeJS.Timeout | undefined;
    const late = new Promise<"late">((resolve) => { timer = setTimeout(() => { resolve("late"); }, SHUTDOWN_DEADLINE_MS); });
    try {
      const answer = await Promise.race([Promise.all([quickChatHome(box.boxRoot), mobileTokenHashesWithAccess(box.boxRoot)]), late]);
      if (answer === "late") {
        console.warn(`[home-snapshot] ${box.slug}: home not ready within ${String(SHUTDOWN_DEADLINE_MS)} ms; no snapshot`);
        return;
      }
      const [home, deviceTokenHashes] = answer;
      const { allowedEmails } = computeHubMeta(box.boxRoot, () => new Date());
      writeHomeSnapshot(box.boxRoot, { slug: box.slug, hubSecret, snapshot: { savedAt: getBoxTimeISO(box.boxRoot), home, deviceTokenHashes, allowedEmails } });
    } catch (e) {
      console.warn(`[home-snapshot] ${box.slug}: could not write a snapshot: ${errorMessage(e)}`);
    } finally {
      clearTimeout(timer);
    }
  }));
}
