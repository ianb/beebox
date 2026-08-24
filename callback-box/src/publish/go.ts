/**
 * `cb pub go <pub-id>` — the human flip (Track E of
 * `docs/plans/publish-pages.md`), the key control of the whole feature: the
 * agent may draft, but **only the human flips a publication live**.
 *
 * The flow re-runs the leak scan on the on-disk bundle, re-displays the
 * file-by-file preview + tier/expiry/allowlist, requires a human confirmation,
 * then uploads in the safe order (bundle objects first, edge manifest last, slug
 * pointer for public tier) and flips the local manifest to `live`.
 *
 * **Human-only flip — procedural, not cryptographic (plan Failure-modes).** The
 * confirmation is an injected {@link ConfirmFn} defaulting to
 * {@link defaultTtyConfirm}, which requires an interactive TTY and a typed
 * pub-id. A non-TTY stdin with no injected confirm REFUSES — it never
 * auto-flips. This gate is a convention the agent is instructed to respect, not
 * a cryptographic lock (an agent with box shell access could script around it);
 * the real controls are the CF token living outside the box, this interactive
 * confirm, and the git + `cb pub ls` audit trail. Doctests inject a stub confirm
 * to drive the flow non-interactively.
 *
 * **Upload order is atomic-ish (plan Failure-modes).** Until the edge manifest
 * lands, the pub is uniformly 404 — never half-served. Re-running after a
 * partial upload re-puts every object (idempotent): a put is an overwrite.
 */

import { readFile, readdir } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import path from "node:path";

import { getBoxDir } from "../lib/paths.js";
import { type FilePreview, fileStats } from "./draft.js";
import { scanBundle, type LeakFinding, type LeakScanResult } from "./leak-scan.js";
import {
  type PublicationManifest,
  type Tier,
  toEdgeManifest,
} from "./manifest.js";
import {
  bundleContentType,
  bundleKey,
  defaultLifecycleCommit,
  type LifecycleCommit,
  loadLocalManifest,
  manifestKey,
  persistAndCommitManifest,
  slugKey,
} from "./lifecycle.js";
import type { PublishRemoteStore } from "../services/publish-remote-store.js";

/** Extensions read back as text (scanned by the leak scan); everything else is binary. */
const TEXT_EXTENSIONS = new Set([".html", ".htm", ".css", ".js", ".mjs", ".json", ".svg", ".txt", ".md", ".xml"]);

/** What the confirm step is shown before the human decides to flip live. */
export interface ConfirmArgs {
  pubId: string;
  tier: Tier;
  expiresAt: string | null;
  allowedEmails: string[] | null;
  slug: string | null;
  files: FilePreview[];
  scan: LeakScanResult;
}

/** The human-flip confirmation seam. Returns true to proceed with the upload. */
export type ConfirmFn = (args: ConfirmArgs) => Promise<boolean>;

export interface GoDeps {
  /** The R2 store, or `null` when publishing is unconfigured (→ `unconfigured`). */
  store: PublishRemoteStore | null;
  /** Box owner email — passed to the re-run leak scan so it isn't flagged. */
  ownerEmail: string | null;
  /** The human-flip confirmation; defaults to the real TTY prompt {@link defaultTtyConfirm}. */
  confirm?: ConfirmFn | undefined;
  /** Commit step; defaults to a path-scoped git commit. Injected in doctests. */
  commit?: LifecycleCommit | undefined;
}

export type GoResult =
  | {
      ok: true;
      pubId: string;
      manifest: PublicationManifest;
      files: FilePreview[];
      scan: LeakScanResult;
      uploadedBundleObjects: number;
      slugPointer: boolean;
    }
  | { ok: false; reason: "unconfigured"; message: string }
  | { ok: false; reason: "not-found"; message: string }
  | { ok: false; reason: "invalid-manifest"; message: string }
  | { ok: false; reason: "not-draft"; message: string; status: string }
  | { ok: false; reason: "leaks-blocked"; files: FilePreview[]; scan: LeakScanResult; blocking: LeakFinding[] }
  | { ok: false; reason: "not-confirmed"; message: string };

/** Read a bundle tree off disk into a scan/upload map (text as string, else binary). */
async function readBundle(bundleDir: string): Promise<Map<string, string | Uint8Array>> {
  const files = new Map<string, string | Uint8Array>();
  const entries = await readdir(bundleDir, { withFileTypes: true, recursive: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const abs = path.join(entry.parentPath, entry.name);
    const rel = path.relative(bundleDir, abs).split(path.sep).join("/");
    const buf = await readFile(abs);
    const ext = path.extname(rel).toLowerCase();
    files.set(rel, TEXT_EXTENSIONS.has(ext) ? buf.toString("utf-8") : new Uint8Array(buf));
  }
  return files;
}

/**
 * The default flip confirmation: a real interactive TTY prompt. REFUSES (returns
 * false) when stdin is not a TTY — the never-auto-flip guarantee. On a TTY it
 * displays the preview and requires the operator to type the pub-id exactly.
 */
const defaultTtyConfirm: ConfirmFn = async (args: ConfirmArgs): Promise<boolean> => {
  if (!process.stdin.isTTY) {
    console.error("cb pub go: refusing to flip live without an interactive terminal (type the pub-id to confirm). No changes made.");
    return false;
  }
  console.log(`\nAbout to publish ${args.pubId} LIVE.`);
  console.log(`  tier: ${args.tier}   expires: ${args.expiresAt ?? "—"}`);
  if (args.slug !== null) console.log(`  slug: ${args.slug}`);
  if (args.allowedEmails !== null) console.log(`  allowed emails: ${args.allowedEmails.length > 0 ? args.allowedEmails.join(", ") : "(none — nobody can view)"}`);
  console.log(`  bundle files: ${args.files.length}${args.scan.findings.length > 0 ? `   leak-scan findings: ${args.scan.findings.length} (accepted at draft)` : "   leak scan: clean"}`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`\nType the pub-id (${args.pubId}) to confirm going live: `);
    return answer.trim() === args.pubId;
  } finally {
    rl.close();
  }
};

/**
 * Flip a drafted publication live. Loads + validates the local manifest, refuses
 * anything not in `draft`, re-runs the leak scan (refusing unaccepted findings),
 * requires the human confirm, then uploads bundle-first / manifest-last and
 * commits the `live` local manifest.
 */
export async function goPublication(
  { boxRoot, pubId }: { boxRoot: string; pubId: string },
  deps: GoDeps,
): Promise<GoResult> {
  const { store, ownerEmail } = deps;
  if (!store) {
    return { ok: false, reason: "unconfigured", message: "publishing is not configured on this box — run 'cb pub setup' first" };
  }

  const loaded = await loadLocalManifest(boxRoot, pubId);
  if (!loaded.ok) return loaded;
  const manifest = loaded.manifest;

  if (manifest.status !== "draft") {
    const hint = manifest.status === "revoked"
      ? "a revoked pub-id is never reused — draft a fresh publication"
      : "it is already live; revoke it with 'cb pub revoke' to take it down";
    return { ok: false, reason: "not-draft", status: manifest.status, message: `publication '${pubId}' is '${manifest.status}', not a draft — ${hint}` };
  }

  // Re-run the leak scan on the on-disk bundle (same gate as draft).
  const bundleDir = path.join(getBoxDir(boxRoot, "publish"), pubId, "bundle");
  const files = await readBundle(bundleDir);
  const allowedEmails = manifest.tier === "accounts" ? manifest.allowedEmails ?? [] : [];
  const scan = scanBundle(files, { ownerEmail, allowedEmails });
  const accepted = new Set(manifest.provenance.acceptedLeaks);
  const blocking = scan.findings.filter((f) => !accepted.has(f.id));

  const preview: FilePreview[] = [...files]
    .map(([p, content]) => ({ path: p, ...fileStats(content) }))
    .toSorted((a, b) => a.path.localeCompare(b.path));

  if (blocking.length > 0) {
    return { ok: false, reason: "leaks-blocked", files: preview, scan, blocking };
  }

  // Human-only flip — never auto-flips (default confirm refuses a non-TTY).
  const confirm = deps.confirm ?? defaultTtyConfirm;
  const confirmed = await confirm({
    pubId,
    tier: manifest.tier,
    expiresAt: manifest.expiresAt,
    allowedEmails: manifest.tier === "accounts" ? allowedEmails : null,
    slug: manifest.tier === "public" ? manifest.slug ?? null : null,
    files: preview,
    scan,
  });
  if (!confirmed) {
    return { ok: false, reason: "not-confirmed", message: `publication '${pubId}' NOT flipped live (confirmation declined). No changes made.` };
  }

  // Upload order: every bundle object FIRST, edge manifest LAST, then the slug
  // pointer. Until the manifest lands the pub is uniformly 404, never half-served.
  const live: PublicationManifest = { ...manifest, status: "live" };
  const sortedFiles = [...files].toSorted((a, b) => a[0].localeCompare(b[0]));
  for (const [rel, content] of sortedFiles) {
    await store.put(bundleKey(pubId, rel), { body: content, contentType: bundleContentType(rel) });
  }
  await store.put(manifestKey(pubId), { body: JSON.stringify(toEdgeManifest(live)), contentType: "application/json" });

  let slugPointer = false;
  if (live.tier === "public" && live.slug !== undefined) {
    await store.put(slugKey(live.slug), { body: pubId, contentType: "text/plain" });
    slugPointer = true;
  }

  // Flip + commit the local manifest to live.
  const commit = deps.commit ?? defaultLifecycleCommit;
  await persistAndCommitManifest({ boxRoot, manifest: live, message: `pub: go ${pubId} (live)` }, commit);

  return { ok: true, pubId, manifest: live, files: preview, scan, uploadedBundleObjects: sortedFiles.length, slugPointer };
}
