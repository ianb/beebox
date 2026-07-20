/**
 * `cb pub draft` core (Track E of `docs/plans/publish-pages.md`).
 *
 * Renders a docs source into a publication bundle, writes the draft to
 * `box/publish/<pub-id>/` (manifest + bundle tree), runs the {@link scanBundle}
 * leak scan, and decides whether the draft may be committed. This is the
 * CF-independent first half of the publish flow — no upload, no Cloudflare, no
 * flip-to-live. Anyone (agent or human) may draft; drafting has no external
 * effect.
 *
 * **Git-commit discipline (plan).** The draft is written to the working tree
 * unconditionally (so the boxholder can preview the exact bytes), but it is
 * *committed to the box repo only after the scan passes or every finding is
 * accepted* — so a caught secret never enters box git history. The commit is an
 * injectable step ({@link DraftDeps.commit}) defaulted to a real path-scoped git
 * commit; doctests inject a recording stub to exercise the
 * render→write→scan→decision logic without a real repo.
 *
 * The function is otherwise pure over its inputs (`now`, `ownerEmail`, and
 * `softwareVersion` are injected — no wall clock, no ambient env read), so the
 * whole decision path is doctestable off this signature.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { boxSlug } from "../lib/box-slug.js";

import { stageAndCommitPaths } from "../lib/git.js";
import { getBoxDir } from "../lib/paths.js";
import { renderDocsPublication } from "./render-docs.js";
import { scanBundle, type LeakFinding, type LeakScanResult } from "./leak-scan.js";
import {
  generatePubId,
  type PubId,
  publicationManifestSchema,
  type PublicationManifest,
  type Tier,
} from "./manifest.js";

/** A source path resolves outside the box root — refuse rather than read it. */
export class SourceEscapesBoxError extends Error {
  readonly source: string;
  constructor(source: string) {
    super(`source path escapes the box: ${source}`);
    this.name = "SourceEscapesBoxError";
    this.source = source;
  }
}

/** One bundle file as shown in the preview: path, byte length, full sha256. */
export interface FilePreview {
  path: string;
  bytes: number;
  sha256: string;
}

export interface DraftInput {
  boxRoot: string;
  /** Path to the `.md` docs source, absolute or relative to `boxRoot`. */
  source: string;
  tier: Tier;
  /** Absolute ISO datetime or a duration (`7d`, `24h`, `30m`) from `now`. */
  expires?: string | undefined;
  /** Viewer allowlist — only valid on the `accounts` tier. */
  emails?: string[] | undefined;
  /** Human slug — only valid on the `public` tier. */
  slug?: string | undefined;
  /** Leak-scan finding ids to wave through (`--accept-leak`). */
  acceptLeaks?: string[] | undefined;
}

export interface DraftContext {
  /** Injected clock reading (e.g. `getBoxTime(boxRoot)`). */
  now: Date;
  /** Box owner email — passed to the leak scan so it isn't flagged. */
  ownerEmail: string | null;
  /** Software version stamped into provenance. */
  softwareVersion: string;
  /**
   * Commit the draft's paths to the box repo. Injectable so doctests need no
   * real repo; when omitted, defaults to a path-scoped git commit
   * ({@link defaultCommit}). The commit only ever runs on a clean/accepted scan.
   */
  commit?: (args: { boxRoot: string; paths: string[]; pubId: PubId }) => Promise<void>;
}

/** The default commit step: a path-scoped git commit of the draft directory. */
export async function defaultCommit(args: { boxRoot: string; paths: string[]; pubId: PubId }): Promise<void> {
  await stageAndCommitPaths(args.boxRoot, {
    paths: args.paths,
    message: `pub: draft ${args.pubId}`,
  });
}

export type DraftResult =
  | {
      ok: true;
      pubId: PubId;
      manifest: PublicationManifest;
      manifestPath: string;
      files: FilePreview[];
      scan: LeakScanResult;
      acceptedLeaks: string[];
      committed: boolean;
    }
  | { ok: false; reason: "invalid-flags"; message: string }
  | { ok: false; reason: "invalid-expires"; message: string }
  | {
      ok: false;
      reason: "leaks-blocked";
      pubId: PubId;
      manifestPath: string;
      files: FilePreview[];
      scan: LeakScanResult;
      /** Findings not covered by `--accept-leak` — these block the commit. */
      blocking: LeakFinding[];
    };

const DURATION_RE = /^(\d+)([dhm])$/;

/** Resolve `--expires` to an absolute ISO string, or `null` when absent. */
function resolveExpiresAt(expires: string | undefined, now: Date): { ok: true; value: string | null } | { ok: false; message: string } {
  if (expires === undefined) return { ok: true, value: null };

  const duration = DURATION_RE.exec(expires);
  if (duration) {
    const amount = Number(duration[1]);
    const unit = duration[2];
    const unitMs = unit === "d" ? 86_400_000 : unit === "h" ? 3_600_000 : 60_000;
    return { ok: true, value: new Date(now.getTime() + amount * unitMs).toISOString() };
  }

  const parsed = new Date(expires);
  if (Number.isNaN(parsed.getTime())) {
    return { ok: false, message: `invalid --expires '${expires}' — use an ISO datetime or a duration like 7d / 24h / 30m` };
  }
  return { ok: true, value: parsed.toISOString() };
}

/**
 * Pre-check the tier/flag combination with a clear, fix-naming message before
 * the schema does the authoritative rejection. The strict discriminated union
 * ({@link publicationManifestSchema}) is the real gate (an out-of-tier field is
 * an unknown key it refuses); this just turns the raw zod error into guidance.
 */
function checkFlagCombo({ tier, slug, emails }: Pick<DraftInput, "tier" | "slug" | "emails">): string | null {
  if (slug !== undefined && tier !== "public") {
    return `tier '${tier}' cannot carry a slug — a slug is public-tier only; use --tier public or drop --slug`;
  }
  if (emails !== undefined && tier !== "accounts") {
    return `tier '${tier}' cannot carry --emails — a viewer allowlist is accounts-tier only; use --tier accounts or drop --emails`;
  }
  return null;
}

/** Byte length + full sha256 hex of a bundle entry (string or binary). */
export function fileStats(content: string | Uint8Array): { bytes: number; sha256: string } {
  const buf = typeof content === "string" ? Buffer.from(content, "utf-8") : Buffer.from(content);
  return { bytes: buf.length, sha256: createHash("sha256").update(buf).digest("hex") };
}

/**
 * Draft a docs publication: render → write bundle+manifest to the working tree →
 * leak scan → decide. Returns a discriminated {@link DraftResult}; the caller
 * (the CLI) turns a non-`ok` result into a clear message and a non-zero exit.
 */
export async function draftPublication(input: DraftInput, ctx: DraftContext): Promise<DraftResult> {
  const commit = ctx.commit ?? defaultCommit;
  const { boxRoot, source, tier, slug, emails } = input;
  const acceptLeaks = input.acceptLeaks ?? [];

  // 1. Flag-combination pre-check (schema is the authoritative backstop below).
  const comboError = checkFlagCombo({ tier, slug, emails });
  if (comboError) return { ok: false, reason: "invalid-flags", message: comboError };

  // 2. Expiry.
  const expiry = resolveExpiresAt(input.expires, ctx.now);
  if (!expiry.ok) return { ok: false, reason: "invalid-expires", message: expiry.message };

  // 3. Render the docs source. The source path is confined to the box root.
  const resolvedSource = path.resolve(boxRoot, source);
  if (resolvedSource !== boxRoot && !resolvedSource.startsWith(boxRoot + path.sep)) {
    throw new SourceEscapesBoxError(source);
  }
  const sourceText = await readFile(resolvedSource, "utf-8");
  const { files } = renderDocsPublication(sourceText, { boxRoot, now: ctx.now });

  // 4. Leak scan, then split accepted vs blocking.
  const scan = scanBundle(files, { ownerEmail: ctx.ownerEmail, allowedEmails: emails ?? [] });
  const acceptSet = new Set(acceptLeaks);
  const blocking = scan.findings.filter((f) => !acceptSet.has(f.id));
  // Only ids that matched a real finding are recorded (a stale accept is dropped).
  const acceptedLeaks = scan.findings.filter((f) => acceptSet.has(f.id)).map((f) => f.id);

  // 5. Assemble the manifest. Slug/emails are placed wherever given so the
  //    strict schema rejects an out-of-tier field (belt to the pre-check's
  //    suspenders). sourceRefs is the box-relative source path.
  const pubId = generatePubId();
  const sourceRef = path.relative(boxRoot, resolvedSource);
  const filesRecord = Object.fromEntries([...files].map(([p, content]) => [p, fileStats(content)]));
  const rawManifest = {
    pubId,
    status: "draft",
    tier,
    expiresAt: expiry.value,
    ...(slug !== undefined ? { slug } : {}),
    ...(emails !== undefined ? { allowedEmails: emails } : {}),
    provenance: {
      boxSlug: await boxSlug(boxRoot),
      renderedAt: ctx.now.toISOString(),
      sourceRefs: [sourceRef],
      renderer: "docs" as const,
      softwareVersion: ctx.softwareVersion,
      ...(acceptedLeaks.length > 0 ? { acceptedLeaks } : {}),
    },
    files: filesRecord,
  };

  const parsed = publicationManifestSchema.safeParse(rawManifest);
  if (!parsed.success) {
    // The strict union rejected the flag combination (e.g. --slug on secret).
    const issue = parsed.error.issues[0];
    const where = issue?.path.join(".") || "manifest";
    return { ok: false, reason: "invalid-flags", message: `invalid publication for tier '${tier}': ${issue?.message ?? "schema rejected"} (${where})` };
  }
  const manifest = parsed.data;

  // 6. Write the draft to the working tree (uncommitted). A fresh pub-id can't
  //    collide, but clear any stale partial dir defensively.
  const pubDir = path.join(getBoxDir(boxRoot, "publish"), pubId);
  await rm(pubDir, { recursive: true, force: true });
  const writtenPaths: string[] = [];
  for (const [rel, content] of files) {
    const dest = path.join(pubDir, "bundle", rel);
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, content);
    writtenPaths.push(dest);
  }
  const manifestPath = path.join(pubDir, "manifest.json");
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  writtenPaths.push(manifestPath);

  const preview: FilePreview[] = [...files]
    .map(([p, content]) => ({ path: p, ...fileStats(content) }))
    .toSorted((a, b) => a.path.localeCompare(b.path));

  // 7. Decide. A blocking finding stops the commit (the secret never enters
  //    git history); a clean-or-accepted scan commits the draft.
  if (blocking.length > 0) {
    return { ok: false, reason: "leaks-blocked", pubId, manifestPath, files: preview, scan, blocking };
  }

  await commit({ boxRoot, paths: writtenPaths, pubId });
  return { ok: true, pubId, manifest, manifestPath, files: preview, scan, acceptedLeaks, committed: true };
}
