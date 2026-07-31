/**
 * Publish-submissions connector (Track F of `docs/plans/publish-pages.md`).
 *
 * On `cb wakeup` it pulls the "drop box" the Cloudflare Worker buffered in R2:
 * viewer submissions (`submissions/<pubId>/<id>.json`) and — for `any-account`
 * pubs — access logs (`access-log/<pubId>/*.json`). Each object is downloaded,
 * `safeParse`d (the edge is **untrusted from the box's side** — principle #3; a
 * bad object is logged and skipped, never crashes the sync), landed in
 * `box/inbox/` as a card, and only then deleted from R2.
 *
 * **At-least-once with idempotent dedup.** The order is land-then-delete:
 * write + commit the card *before* deleting the remote object, so a crash
 * between the two leaves the object for the next pull. Submissions dedupe by the
 * submission `id` (its card filename) — a re-pull that sees an already-landed id
 * writes no duplicate and just deletes the leftover object. Access-log digests
 * are aggregates and are NOT deduped: a crash-between can produce a second
 * overlapping digest (acceptable — the box is the system of record and a
 * duplicate summary is harmless).
 *
 * **Activation.** The credential is the per-box secret file
 * `config/connectors/publish.secret.json` (gitignored via the box scaffold,
 * same pattern as every other connector secret): an API token scoped to ONLY
 * the ingestion bucket — it cannot touch publication manifests/content (the
 * bucket split, `docs/implemented-plans/pub-setup-wrangler.md` amendment 1). The
 * `CLOUDFLARE_*` env triple stays as a fallback. Neither resolves → `sync()`
 * is a silent no-op. The `PublishRemoteStore` is injectable so the pull logic
 * is fully doctestable against a fake with no network.
 */

import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { z } from "zod";

import { registerConnector, type Connector, type SyncResult } from "./index.js";
import { renderFrontmatterBlock } from "../cards/index.js";
import { getBoxDir } from "../lib/paths.js";
import { fileExists } from "../lib/file-exists.js";
import { getBoxTime } from "../lib/time.js";
import { errorMessage } from "../lib/error-guards.js";
import { stageAndCommitPaths } from "../lib/git.js";
import { submissionSchema } from "../publish/submission.js";
import { createPubSubmissionCard } from "../schemas/pub-submission.js";
import {
  createR2PublishStore,
  r2ConfigFromEnv,
  type PublishRemoteStore,
  type R2PublishStoreConfig,
} from "../services/publish-remote-store.js";
import { staticBearer } from "../services/cloudflare-bearer.js";

/** The per-box connector secret: an ingestion-bucket-scoped R2 token (never the broad management token). */
const publishSecretSchema = z
  .object({
    accountId: z.string().min(1),
    bucket: z.string().min(1),
    apiToken: z.string().min(1),
  })
  .strict();

/** Path of the connector's secret file (same pattern as the other connector secrets). */
export function publishSecretPath(boxRoot: string): string {
  return path.join(boxRoot, "config", "connectors", "publish.secret.json");
}

/**
 * Read the connector credential from the box's secret file; `null` when the
 * file is absent (publishing not configured). A file that exists but fails
 * the schema throws — a malformed credential should be fixed, not silently
 * treated as "no publishing".
 */
export async function readPublishSecret(boxRoot: string): Promise<R2PublishStoreConfig | null> {
  let raw: string;
  try {
    raw = await readFile(publishSecretPath(boxRoot), "utf-8");
  } catch (e) {
    if (e instanceof Error && "code" in e && e.code === "ENOENT") return null;
    throw e;
  }
  const parsed = publishSecretSchema.parse(JSON.parse(raw));
  return { accountId: parsed.accountId, bucket: parsed.bucket, bearer: staticBearer(parsed.apiToken) };
}

/** An `any-account` access-log object: `{ ts, pubId, email }` (edge-written). */
const accessLogEntrySchema = z
  .object({
    ts: z.string(),
    pubId: z.string(),
    email: z.string(),
  })
  .strict();

type AccessLogEntry = z.infer<typeof accessLogEntrySchema>;

/** Injectable seams — a fake store, a fixed clock, a recording commit. */
export interface PublishSubmissionsDeps {
  /** Remote object store; when omitted, built from env (or no-op if unconfigured). */
  store?: PublishRemoteStore | undefined;
  /** Clock for landed-at / digest timestamps; defaults to box time. */
  now?: (() => Date) | undefined;
  /** Commit step; defaults to a path-scoped git commit. Injected in doctests. */
  commit?: ((args: { boxRoot: string; paths: string[]; message: string }) => Promise<void>) | undefined;
}

/** Decode raw object bytes and JSON-parse; returns null on malformed input. */
function parseJsonBytes(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (_e) {
    // Untrusted edge object wasn't valid JSON — caller logs and skips.
    return null;
  }
}

/** Filesystem-safe card basename stem for a submission id. */
function submissionCardName(id: string): string {
  const safe = id.replace(/[^\w-]/g, "_");
  return `Submission-${safe}.pub-submission.card`;
}

class PublishSubmissionsConnector implements Connector {
  name = "publish-submissions";
  produces = ["pub-submission", "memo"];
  inboxPaths: string[] = [];
  triggeredBy?: string;

  private boxRoot: string;
  private deps: PublishSubmissionsDeps;

  constructor(boxRoot: string, deps?: PublishSubmissionsDeps) {
    this.boxRoot = boxRoot;
    this.deps = deps ?? {};
  }

  /** Resolve the store: injected, else the per-box secret file, else the env fallback, else null (no-op). */
  private async resolveStore(): Promise<PublishRemoteStore | null> {
    if (this.deps.store) return this.deps.store;
    const config = (await readPublishSecret(this.boxRoot)) ?? r2ConfigFromEnv();
    if (!config) return null;
    return createR2PublishStore(config);
  }

  private now(): Date {
    return this.deps.now ? this.deps.now() : getBoxTime(this.boxRoot);
  }

  private async commit(paths: string[], message: string): Promise<void> {
    if (paths.length === 0) return;
    if (this.deps.commit) {
      await this.deps.commit({ boxRoot: this.boxRoot, paths, message });
      return;
    }
    await stageAndCommitPaths(this.boxRoot, {
      paths,
      message,
      trailers: {
        "Pulled-By": "publish-submissions-connector",
        ...(this.triggeredBy ? { "Triggered-By": this.triggeredBy } : {}),
      },
    });
  }

  async sync(): Promise<SyncResult> {
    const store = await this.resolveStore();
    if (!store) {
      // Publishing not configured on this box — nothing to pull.
      return { success: true, created: [], updated: [] };
    }

    try {
      const submissions = await this.pullSubmissions(store);
      const logs = await this.pullAccessLogs(store);

      const created = [...submissions.created, ...logs.created];
      // Land (commit) every new card BEFORE deleting any remote object.
      await this.commit(created, this.commitMessage(submissions.created.length, logs.created.length));

      // Now delete the pulled objects (submissions already-landed included).
      for (const key of [...submissions.deleteKeys, ...logs.deleteKeys]) {
        await store.delete(key);
      }

      return { success: true, created, updated: [] };
    } catch (err) {
      return {
        success: false,
        created: [],
        updated: [],
        error: `publish-submissions pull failed: ${errorMessage(err)}`,
      };
    }
  }

  private commitMessage(submissionCount: number, digestCount: number): string {
    const parts: string[] = [];
    if (submissionCount > 0) parts.push(`${submissionCount} submission${submissionCount === 1 ? "" : "s"}`);
    if (digestCount > 0) parts.push(`${digestCount} access-log digest${digestCount === 1 ? "" : "s"}`);
    return `pub: pull ${parts.join(" + ")}`;
  }

  /**
   * Pull submissions: for each object, validate, write a `pub-submission` card
   * (skipping ids already landed), and mark the object for deletion. Malformed
   * objects are logged and left in place (no write, no delete) for inspection.
   */
  private async pullSubmissions(store: PublishRemoteStore): Promise<{ created: string[]; deleteKeys: string[] }> {
    const inboxDir = getBoxDir(this.boxRoot, "inbox");
    const created: string[] = [];
    const deleteKeys: string[] = [];

    for (const key of await store.listSubmissions()) {
      const parsed = submissionSchema.safeParse(parseJsonBytes(await store.get(key)));
      if (!parsed.success) {
        console.warn(`publish-submissions: skipping malformed submission object '${key}' (left in R2 for inspection)`);
        continue;
      }
      const submission = parsed.data;
      const cardPath = path.join(inboxDir, submissionCardName(submission.id));

      // Idempotent: a card for this id already on disk means a prior pull landed
      // it (possibly crashing before delete). Don't duplicate — just delete.
      if (!(await fileExists(cardPath))) {
        const cardText = createPubSubmissionCard({
          pubId: submission.pubId,
          submittedAt: submission.ts,
          created: this.now().toISOString(),
          viewer: submission.viewer,
          country: submission.country,
          fields: submission.fields,
        });
        await mkdir(inboxDir, { recursive: true });
        await writeFile(cardPath, cardText);
        created.push(cardPath);
      }
      deleteKeys.push(key);
    }

    return { created, deleteKeys };
  }

  /**
   * Pull access logs: validate each `{ts,pubId,email}` object (skip malformed),
   * aggregate into one digest memo card, and mark every pulled object for
   * deletion. No digest is written when there are no valid entries.
   */
  private async pullAccessLogs(store: PublishRemoteStore): Promise<{ created: string[]; deleteKeys: string[] }> {
    const deleteKeys: string[] = [];
    const entries: AccessLogEntry[] = [];

    for (const key of await store.listAccessLogs()) {
      const parsed = accessLogEntrySchema.safeParse(parseJsonBytes(await store.get(key)));
      if (!parsed.success) {
        console.warn(`publish-submissions: skipping malformed access-log object '${key}' (left in R2 for inspection)`);
        continue;
      }
      entries.push(parsed.data);
      deleteKeys.push(key);
    }

    if (entries.length === 0) return { created: [], deleteKeys };

    const inboxDir = getBoxDir(this.boxRoot, "inbox");
    const now = this.now();
    const cardPath = path.join(inboxDir, `Access-Log-Digest-${now.toISOString().replace(/[.:]/g, "-")}.memo.card`);
    await mkdir(inboxDir, { recursive: true });
    await writeFile(cardPath, this.renderDigest(entries, now));

    return { created: [cardPath], deleteKeys };
  }

  /** Render an access-log digest as a memo card (untrusted, edge-supplied emails). */
  private renderDigest(entries: AccessLogEntry[], now: Date): string {
    const byPub = new Map<string, AccessLogEntry[]>();
    for (const entry of entries) {
      const list = byPub.get(entry.pubId) ?? [];
      list.push(entry);
      byPub.set(entry.pubId, list);
    }

    const sections: string[] = [];
    for (const pubId of [...byPub.keys()].toSorted()) {
      const list = byPub.get(pubId) ?? [];
      sections.push(`## ${pubId} — ${list.length} view${list.length === 1 ? "" : "s"}`);
      for (const entry of list.toSorted((a, b) => a.ts.localeCompare(b.ts))) {
        sections.push(`- ${entry.ts} — ${entry.email}`);
      }
    }

    const body = [
      "Access-log digest pulled from published `any-account` pages.",
      "",
      "The emails below are edge-verified identities of people who opened an",
      "account-gated publication. Treat as a record, not as a to-do list.",
      "",
      ...sections,
      "",
    ].join("\n");

    const frontmatter = {
      status: "new",
      created: now.toISOString(),
      source: "publish-access-log",
      title: `Access-log digest (${entries.length} view${entries.length === 1 ? "" : "s"})`,
    };
    return renderFrontmatterBlock(frontmatter, body);
  }
}

/** Create and register the publish-submissions connector for a box. */
export function createPublishSubmissionsConnector(boxRoot: string, deps?: PublishSubmissionsDeps): Connector {
  const connector = new PublishSubmissionsConnector(boxRoot, deps);
  registerConnector(connector);
  return connector;
}
