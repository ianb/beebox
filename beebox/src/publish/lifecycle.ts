/**
 * Publication lifecycle core (Track E of `docs/plans/publish-pages.md`) — the
 * Cloudflare-facing half of `bbx pub`: listing local publications (`ls`),
 * revoking a live one (`revoke`), and the shared plumbing the human flip
 * (`go`, in `go.ts`) also uses.
 *
 * Everything CF/R2-touching is factored into functions that take an injected
 * {@link PublishRemoteStore} (plus an injected clock/commit), so the whole flow
 * is doctestable end-to-end against `createFakePublishStore` with no network.
 * The CLI action (`src/cli/commands/pub.ts`) wires the real store from env and
 * the real TTY confirm; doctests inject fakes.
 *
 * ## R2 key layout (plan Track A)
 *  - `pubs/<id>/manifest.json` — the edge manifest subset the Worker serves
 *  - `pubs/<id>/bundle/<path>` — the rendered static tree
 *  - `slugs/<slug>` — public-tier pointer object (value = pub-id)
 *
 * ## Revoke = ONE fail-close action (plan Track E / the Notion lesson)
 * Overwrite the edge manifest with a `status: "revoked"` tombstone FIRST — R2 is
 * strongly consistent, so the next request 410s (pages *and* submit die
 * together). Only then delete the bundle objects and slug pointer, best-effort:
 * a delete failure is logged, never fatal, because the tombstone already
 * fail-closes. A revoked pub-id is never reused.
 */

import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { getBoxDir } from "../lib/paths.js";
import { stageAndCommitPaths } from "../lib/git.js";
import { errorMessage } from "../lib/error-guards.js";
import { extensionToMimetype } from "../lib/mimetype.js";
import {
  createR2PublishStore,
  r2ConfigFromEnv,
  type PublishRemoteStore,
} from "../services/publish-remote-store.js";
import { createWranglerService, type WranglerService } from "../services/wrangler.js";
import { resolveCloudflareAuth } from "./cloudflare-auth.js";
import { readPubWorkerConfig } from "./pub-worker-meta.js";
import {
  type PubId,
  publicationManifestSchema,
  type PublicationManifest,
  toEdgeManifest,
} from "./manifest.js";

// ---------------------------------------------------------------------------
// R2 key layout + content types
// ---------------------------------------------------------------------------

/** R2 key for a publication's edge manifest. */
export function manifestKey(pubId: string): string {
  return `pubs/${pubId}/manifest.json`;
}

/** R2 key prefix for a publication's bundle objects. */
function bundlePrefix(pubId: string): string {
  return `pubs/${pubId}/bundle/`;
}

/** R2 key for one bundle object at a bundle-relative path. */
export function bundleKey(pubId: string, relPath: string): string {
  return `${bundlePrefix(pubId)}${relPath}`;
}

/** R2 key for a public-tier slug pointer (value = pub-id). */
export function slugKey(slug: string): string {
  return `slugs/${slug}`;
}

/**
 * Content-type for a bundle object, by extension. A small local reuse of the
 * shared {@link extensionToMimetype} table (which already carries `.html`,
 * images, etc.) rather than a copy of the Worker's map — same discipline,
 * no cross-package import. Unknown extensions fall back to a safe binary type.
 */
export function bundleContentType(relPath: string): string {
  return extensionToMimetype(path.extname(relPath), { fallback: "application/octet-stream" });
}

// ---------------------------------------------------------------------------
// Store resolution + commit seam
// ---------------------------------------------------------------------------

/** A resolved store, or a precise reason there is none (not-logged-in vs multi-account). */
export type PublishStoreResolution = { store: PublishRemoteStore } | { store: null; message: string };

/**
 * Resolve the CONTENT-bucket R2 store the laptop-side lifecycle commands
 * (`bbx pub go`/`revoke`) write through: the injected one wins (doctests), then
 * the env-creds escape hatch, then the wrangler-OAuth login (bucket from the
 * committed `wrangler.jsonc`, bearer refreshed through the login — the plan's
 * credential model). No credential ⇒ a precise refusal message.
 */
export async function resolvePublishStore(opts?: {
  store?: PublishRemoteStore | undefined;
  env?: NodeJS.ProcessEnv | undefined;
  wrangler?: WranglerService | undefined;
}): Promise<PublishStoreResolution> {
  if (opts?.store) return { store: opts.store };
  const envConfig = r2ConfigFromEnv(opts?.env);
  if (envConfig) return { store: createR2PublishStore(envConfig) };
  const wrangler = opts?.wrangler ?? createWranglerService();
  const resolved = await resolveCloudflareAuth({}, { env: opts?.env, wrangler });
  if (!resolved.ok) return { store: null, message: resolved.message };
  const config = await readPubWorkerConfig();
  return {
    store: createR2PublishStore({
      accountId: resolved.auth.accountId,
      bucket: config.bucketName,
      bearer: resolved.auth.bearer,
    }),
  };
}

/** Commit the updated local manifest. Injectable so doctests need no real repo. */
export type LifecycleCommit = (args: { boxRoot: string; paths: string[]; pubId: PubId; message: string }) => Promise<void>;

/** Default commit: a path-scoped git commit of the manifest. */
export const defaultLifecycleCommit: LifecycleCommit = async (args) => {
  await stageAndCommitPaths(args.boxRoot, { paths: args.paths, message: args.message });
};

// ---------------------------------------------------------------------------
// Local manifest load / persist
// ---------------------------------------------------------------------------

/** Absolute path to a publication's local manifest. */
function localManifestPath(boxRoot: string, pubId: string): string {
  return path.join(getBoxDir(boxRoot, "publish"), pubId, "manifest.json");
}

/** Outcome of loading + validating a local manifest. */
export type LoadManifestResult =
  | { ok: true; manifest: PublicationManifest }
  | { ok: false; reason: "not-found"; message: string }
  | { ok: false; reason: "invalid-manifest"; message: string };

/** Read `box/publish/<id>/manifest.json` and `safeParse` it (config is untrusted). */
export async function loadLocalManifest(boxRoot: string, pubId: string): Promise<LoadManifestResult> {
  let raw: string;
  try {
    raw = await readFile(localManifestPath(boxRoot, pubId), "utf-8");
  } catch (_e) {
    return { ok: false, reason: "not-found", message: `no publication '${pubId}' under box/publish/ — check the id with 'bbx pub ls'` };
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (e) {
    return { ok: false, reason: "invalid-manifest", message: `manifest for '${pubId}' is not valid JSON: ${errorMessage(e)}` };
  }
  const parsed = publicationManifestSchema.safeParse(parsedJson);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.join(".") || "manifest";
    return { ok: false, reason: "invalid-manifest", message: `manifest for '${pubId}' is invalid: ${issue?.message ?? "schema rejected"} (${where})` };
  }
  return { ok: true, manifest: parsed.data };
}

/** Persist a manifest to disk and commit it, returning the committed path. */
export async function persistAndCommitManifest(
  { boxRoot, manifest, message }: { boxRoot: string; manifest: PublicationManifest; message: string },
  commit: LifecycleCommit,
): Promise<string> {
  const dest = localManifestPath(boxRoot, manifest.pubId);
  await writeFile(dest, JSON.stringify(manifest, null, 2) + "\n");
  await commit({ boxRoot, paths: [dest], pubId: manifest.pubId, message });
  return dest;
}

// ---------------------------------------------------------------------------
// `bbx pub ls` — read-only listing (no Cloudflare)
// ---------------------------------------------------------------------------

/** One row of `bbx pub ls`. `invalid` marks a manifest that failed to parse. */
export interface PublicationSummary {
  pubId: string;
  tier: string;
  status: string;
  expiresAt: string | null;
  slug: string | null;
  allowedEmails: string[] | null;
  source: string;
  renderedAt: string;
  invalid: boolean;
}

/**
 * List the box's publications from each `box/publish/<id>/manifest.json`.
 * Read-only, no CF. Sorted by `renderedAt` then `pubId` (stable). A parse failure yields a row
 * flagged `invalid` rather than being dropped, so hand-edit drift stays visible.
 */
export async function listPublications(boxRoot: string): Promise<PublicationSummary[]> {
  const publishDir = getBoxDir(boxRoot, "publish");
  let entries: string[];
  try {
    entries = await readdir(publishDir);
  } catch (_e) {
    // No publish directory yet — the box has never drafted a publication.
    return [];
  }

  const summaries: PublicationSummary[] = [];
  for (const pubId of entries.toSorted()) {
    const loaded = await loadLocalManifest(boxRoot, pubId);
    if (!loaded.ok) {
      if (loaded.reason === "not-found") continue; // a non-publication entry (e.g. a stray file)
      summaries.push({ pubId, tier: "?", status: "invalid", expiresAt: null, slug: null, allowedEmails: null, source: loaded.message, renderedAt: "", invalid: true });
      continue;
    }
    const m = loaded.manifest;
    summaries.push({
      pubId: m.pubId,
      tier: m.tier,
      status: m.status,
      expiresAt: m.expiresAt,
      slug: m.tier === "public" ? m.slug ?? null : null,
      allowedEmails: m.tier === "accounts" ? m.allowedEmails ?? [] : null,
      source: m.provenance.sourceRefs.join(", "),
      renderedAt: m.provenance.renderedAt,
      invalid: false,
    });
  }

  return summaries.toSorted((a, b) => a.renderedAt.localeCompare(b.renderedAt) || a.pubId.localeCompare(b.pubId));
}

// ---------------------------------------------------------------------------
// `bbx pub revoke` — the one fail-close action
// ---------------------------------------------------------------------------

export interface RevokeDeps {
  /** The R2 store, or `null` when publishing is unconfigured (→ `unconfigured`). */
  store: PublishRemoteStore | null;
  commit?: LifecycleCommit | undefined;
}

export type RevokeResult =
  | { ok: true; pubId: string; deletedBundleObjects: number; deletedSlug: boolean }
  | { ok: false; reason: "unconfigured"; message: string }
  | { ok: false; reason: "not-found"; message: string }
  | { ok: false; reason: "invalid-manifest"; message: string };

/**
 * Revoke a publication: tombstone the edge manifest FIRST (fail-close), then
 * best-effort delete the bundle objects and any public-tier slug pointer, then
 * flip + commit the local manifest to `revoked`. Idempotent — re-revoking a
 * already-revoked pub just re-writes the tombstone.
 */
export async function revokePublication(
  { boxRoot, pubId }: { boxRoot: string; pubId: string },
  deps: RevokeDeps,
): Promise<RevokeResult> {
  const { store } = deps;
  if (!store) {
    return { ok: false, reason: "unconfigured", message: "publishing is not configured on this box — run 'bbx pub setup' first" };
  }

  const loaded = await loadLocalManifest(boxRoot, pubId);
  if (!loaded.ok) return loaded;

  const revoked: PublicationManifest = { ...loaded.manifest, status: "revoked" };
  const commit = deps.commit ?? defaultLifecycleCommit;

  // 1. Tombstone FIRST — the next request 410s on strong consistency.
  await store.put(manifestKey(pubId), { body: JSON.stringify(toEdgeManifest(revoked)), contentType: "application/json" });

  // 2. Best-effort delete of the bundle objects (the tombstone already fail-closes).
  let deletedBundleObjects = 0;
  const bundleKeys = await store.list(bundlePrefix(pubId));
  for (const key of bundleKeys) {
    try {
      await store.delete(key);
      deletedBundleObjects++;
    } catch (e) {
      console.warn(`bbx pub revoke: failed to delete bundle object '${key}' (tombstone already fail-closes): ${errorMessage(e)}`);
    }
  }

  // 3. Best-effort delete of the public-tier slug pointer.
  let deletedSlug = false;
  if (revoked.tier === "public" && revoked.slug !== undefined) {
    try {
      await store.delete(slugKey(revoked.slug));
      deletedSlug = true;
    } catch (e) {
      console.warn(`bbx pub revoke: failed to delete slug pointer '${revoked.slug}': ${errorMessage(e)}`);
    }
  }

  // 4. Flip + commit the local manifest.
  await persistAndCommitManifest({ boxRoot, manifest: revoked, message: `pub: revoke ${pubId}` }, commit);

  return { ok: true, pubId, deletedBundleObjects, deletedSlug };
}
