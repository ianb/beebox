// `v.picture` and `v.pixels` (draft section 5): find or record the version
// for the current values. In testing mode an asked-for version is recorded
// again and compared when its audit is due (`PictureTable.auditDue`), and a
// difference warns, telling a stale capture (the
// body reads a value not in deps) from two drawings sharing a key. A key that
// records a new version in every frame for over half a second, whose versions
// are not asked for again, warns.
import { SketchUsageError } from "../../core/errors.js";
import type { PictureOptions } from "../../core/tea.js";
import { versionName } from "../outline.js";
import type { PaperSettings, PictureVersion, PixelsVersion, SceneNode } from "../nodes.js";
import { PictureHandle, REUSE_WINDOW, checkPictureOptions, copyDeps, firstDifference, sameData } from "./pictures.js";
import { DEFAULT_PAPER, resolvePaper } from "./brush-style.js";
import type { PictureTable } from "./pictures.js";

/** What the recorder lends a picture call. */
export interface PictureScope {
  readonly table: PictureTable;
  readonly audit: boolean;
  readonly frame: object;
  /** Record a body in the picture's own coordinates, box and paper; `again` for a testing-mode re-record of a kept version. */
  readonly recordBody: (name: string, a: { size: { width: number; height: number }; paper: PaperSettings; body: () => unknown; again: boolean }) => readonly SceneNode[];
  readonly warn: (once: string, message: string) => void;
  /** A new version was recorded, taking `ms`. */
  readonly recorded: (key: string, ms: number) => void;
}

type Version = PictureVersion | PixelsVersion;

/** The clock, kept at load: a headless run's determinism guard refuses `performance.now` while the sketch runs, and timing a body is the runtime's business. */
const clock = performance.now.bind(performance);
type Fill = (image: { data: Uint8ClampedArray; width: number; height: number }) => void;

const depsText = (v: Version): string => (v.deps === undefined ? "no deps" : `deps ${JSON.stringify(v.deps)}`);

function added(s: PictureScope, version: Version): PictureHandle {
  const run = s.table.add(version);
  if (run !== undefined) {
    s.warn(`every ${version.key}`, `${version.kind} "${version.key}" recorded a new version in each of the last ${run} frames (now ${depsText(version)}, ${version.width}×${version.height}), and the versions from ${REUSE_WINDOW} frames ago were not asked for again: its deps or size change every frame, so each new version is used once; keep per-frame values out of the ${version.kind} and apply them with at, place or a drawing beside it`);
  }
  return new PictureHandle(version, s.frame);
}

function warnStale(s: PictureScope, a: { name: string; version: Version; diff: string }): void {
  const deps = depsText(a.version);
  const shared = s.table.madeThisFrame(a.version);
  const why = shared
    ? `was asked for twice this frame with the same key and ${deps} and drew differently: two drawings share the key, or the body reads a value (such as a loop variable) that is not in deps`
    : `drew differently from its kept version with the same key and ${deps}: the body reads a value (a model field, a param, the frame) that is not in deps, so the kept version is stale`;
  s.warn(`${shared ? "shared" : "stale"} ${a.version.key}`, `${a.name} ${why}; first difference at ${a.diff}`);
}

export function recordPicture(s: PictureScope, a: { options: PictureOptions; body: () => unknown }): PictureHandle {
  const { key, width, height } = checkPictureOptions(a.options, "picture");
  const deps = copyDeps(a.options.deps, key);
  const paper = a.options.paper === undefined ? DEFAULT_PAPER : resolvePaper(a.options.paper);
  const found = s.table.find({ kind: "picture", key, width, height, deps, paper });
  if (found !== undefined && !(s.audit && s.table.auditDue(found))) return new PictureHandle(found, s.frame);
  const name = versionName({ kind: "picture", key, deps });
  const t0 = clock();
  const children = s.recordBody(name, { size: { width, height }, paper, body: a.body, again: found !== undefined });
  if (found?.kind === "picture") {
    const diff = firstDifference({ a: found.children, b: children }, name);
    if (diff !== undefined) warnStale(s, { name, version: found, diff });
    return new PictureHandle(found, s.frame);
  }
  s.recorded(key, clock() - t0);
  return added(s, { kind: "picture", key, width, height, deps, paper, children });
}

export function recordPixels(s: PictureScope, a: { options: PictureOptions; fill: Fill }): PictureHandle {
  const { key, width, height } = checkPictureOptions(a.options, "pixels");
  const deps = copyDeps(a.options.deps, key);
  const found = s.table.find({ kind: "pixels", key, width, height, deps });
  if (found !== undefined && !(s.audit && s.table.auditDue(found))) return new PictureHandle(found, s.frame);
  const t0 = clock();
  const given = new Uint8ClampedArray(width * height * 4);
  const image = { data: given, width, height };
  a.fill(image);
  const name = versionName({ kind: "pixels", key, deps });
  if (image.data !== given) throw new SketchUsageError({ detail: `${name}: the fill replaced image.data; write into the array it is given (data[(y * width + x) * 4 + channel] = …), which holds ${width}×${height}×4 bytes` });
  const data = new Uint8Array(given);
  if (found !== undefined) {
    if (!sameData(found.kind === "pixels" ? found.data : undefined, data)) s.warn(`stale ${key}`, `${name} filled differently with the same deps: the fill reads a value that is not in deps`);
    return new PictureHandle(found, s.frame);
  }
  if (s.audit && data.every((v, i) => i % 4 !== 3 || v === 0)) s.warn(`clear ${key}`, `${name}: the fill left every pixel transparent (alpha is every 4th byte, data[i + 3]; 255 is opaque)`);
  s.recorded(key, clock() - t0);
  return added(s, { kind: "pixels", key, width, height, deps, data });
}
