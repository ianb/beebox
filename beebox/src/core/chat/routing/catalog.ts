import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parse as parseYaml, YAMLParseError } from "yaml";
import { z } from "zod";
import { errnoCode } from "../../../lib/error-guards.js";
import { getBoxTime } from "../../../lib/time.js";
import { parseRef, resolveRefPath } from "../../../shared/ref-path.js";
import { loadLandmarkSummaries, type LandmarkSummary } from "../../landmark/summaries.js";
import { loadAllSessions, type ChatSessionRow } from "../session/list.js";
import { loadSessionHistory } from "../session/load-history.js";
import { CHAT_FRESH_WINDOW_MS } from "../session/recent-landmark.js";
import type { RoutingCandidate, RoutingRule } from "./policy.js";

export const ROUTING_RUBRIC_PATH = "_config/chat-routing.yaml";
const RubricSchema = z.object({
  destinations: z.array(z.object({
    target: z.string().min(1), when: z.string().min(1).max(2000),
    avoid: z.string().max(1000).optional(),
    examples: z.array(z.string().max(500)).max(5).optional(),
    keepEligible: z.boolean().optional(),
  }).strict()).max(100),
}).strict();
type RoutingRubric = z.infer<typeof RubricSchema>;

export class RoutingCatalogError extends Error {
  constructor({ reason, target }: { reason: "stale-target" | "overflow" | "landmarks" | "rubric" | "size"; target?: string }) {
    const messages = {
      "stale-target": `Chat routing rubric target is unavailable: ${target ?? ""}`,
      overflow: "Too many eligible chats for routing. Choose a destination manually.",
      rubric: "Chat routing rubric is invalid. Check _config/chat-routing.yaml.",
      size: "Chat routing rules and destination details exceed the request budget. Shorten the rubric or choose a destination manually.",
      landmarks: "Some landmarks could not be read. Repair them before using Quick chat.",
    };
    super(messages[reason]);
    this.name = "RoutingCatalogError";
  }
}

export async function loadRoutingRubric(boxRoot: string): Promise<RoutingRubric> {
  let content: string;
  try { content = await fs.readFile(path.join(boxRoot, ROUTING_RUBRIC_PATH), "utf8"); }
  catch (error) {
    if (errnoCode(error) === "ENOENT") return { destinations: [] };
    throw error;
  }
  try { return RubricSchema.parse(parseYaml(content)); }
  catch (error) {
    if (error instanceof YAMLParseError || error instanceof z.ZodError) {
      throw new RoutingCatalogError({ reason: "rubric" });
    }
    throw error;
  }
}

function resolveRules(args: {
  sessions: { huskPath: string }[]; landmarks: LandmarkSummary[]; rubric: RoutingRubric;
}): { rules: Map<string, RoutingRule[]>; retained: Set<string> } {
  const rules = new Map<string, RoutingRule[]>();
  const retained = new Set<string>();
  const allPaths = new Set([...args.landmarks.map((item) => item.path), ...args.sessions.map((item) => item.huskPath)]);
  for (const entry of args.rubric.destinations) {
    const parsed = parseRef(entry.target);
    const ref = resolveRefPath({ fromPath: ROUTING_RUBRIC_PATH, ref: parsed.path, kind: "markdown" });
    if (ref === null || parsed.fragment !== undefined || parsed.query !== undefined || !allPaths.has(ref)) {
      throw new RoutingCatalogError({ reason: "stale-target", target: entry.target });
    }
    const { when, avoid, examples } = entry;
    rules.set(ref, [...(rules.get(ref) ?? []), { when, avoid, examples }]);
    if (entry.keepEligible === true) retained.add(ref);
  }
  return { rules, retained };
}

/** Membership comes from current session owners, not a parallel permanent registry. */
export function buildRoutingCandidates(args: {
  sessions: Pick<ChatSessionRow, "sessionId" | "contextDir" | "mtime" | "huskPath" | "label">[];
  landmarks: LandmarkSummary[]; rubric: RoutingRubric; now: number;
}): RoutingCandidate[] {
  const { rules, retained } = resolveRules(args);
  const landmarks = args.landmarks.filter((item) => item.prominence !== "background" || rules.has(item.path));
  const landmarkDirs = new Map(landmarks.map((item) => [item.dir, item]));
  const hiddenDirs = new Set(args.landmarks.filter((item) => item.prominence === "background" && !rules.has(item.path)).map((item) => item.dir));
  const candidates: RoutingCandidate[] = [];
  const seenLandmarks = new Set<string>();
  const sorted = args.sessions.toSorted((a, b) => b.mtime.getTime() - a.mtime.getTime() || a.sessionId.localeCompare(b.sessionId));
  for (const session of sorted) {
    const contextDir = session.contextDir ?? "";
    const landmark = landmarkDirs.get(contextDir);
    const explicit = retained.has(session.huskPath);
    if (hiddenDirs.has(contextDir) && !explicit) continue;
    const latestLandmark = landmark !== undefined && !seenLandmarks.has(contextDir);
    if (landmark !== undefined) seenLandmarks.add(contextDir);
    if (!latestLandmark && !explicit && session.mtime.getTime() < args.now - CHAT_FRESH_WINDOW_MS) continue;
    const rubric = [...(landmark === undefined ? [] : rules.get(landmark.path) ?? []), ...(rules.get(session.huskPath) ?? [])];
    candidates.push({
      id: `c${String(candidates.length)}`, label: session.label.slice(0, 300),
      target: { kind: "existing-session", sessionId: session.sessionId, contextDir },
      lastActivity: session.mtime.toISOString(),
      ...(landmark === undefined ? {} : { landmark: { path: landmark.path, label: landmark.label.slice(0, 300) } }),
      ...(rubric.length === 0 ? {} : { rubric }),
    });
  }
  for (const landmark of landmarks) {
    if (landmark.dir === "") continue;
    candidates.push({
      id: `c${String(candidates.length)}`, label: `New chat in ${landmark.label.slice(0, 300)}`,
      target: { kind: "new-session", contextDir: landmark.dir },
      landmark: { path: landmark.path, label: landmark.label.slice(0, 300) },
      ...(rules.has(landmark.path) ? { rubric: rules.get(landmark.path) } : {}),
    });
  }
  const rootLandmark = landmarkDirs.get("");
  candidates.push({ id: `c${String(candidates.length)}`, label: "New general chat", target: { kind: "new-session", contextDir: "" },
    ...(rootLandmark === undefined ? {} : { landmark: { path: rootLandmark.path, label: rootLandmark.label.slice(0, 300) }, rubric: rules.get(rootLandmark.path) }),
  });
  candidates.push({ id: `c${String(candidates.length)}`, label: "No suitable destination — ask me", target: { kind: "no-match" } });
  if (candidates.length > 255) throw new RoutingCatalogError({ reason: "overflow" });
  return candidates;
}

/** Keep every destination; share the excerpt budget evenly and report shortened evidence. */
export function boundRoutingContexts(candidates: RoutingCandidate[]): RoutingCandidate[] {
  const count = candidates.filter(candidate => candidate.target.kind === "existing-session").length;
  const applyLimit = (limit: number) => candidates.map(candidate => {
    if (candidate.target.kind !== "existing-session") return candidate;
    const text = candidate.recentContext ?? "";
    return { ...candidate, recentContext: limit === 0 ? "" : text.slice(-limit),
      contextTruncated: candidate.contextTruncated === true || text.length > limit };
  });
  const metadata = applyLimit(0);
  if (JSON.stringify(metadata).length > 60_000) throw new RoutingCatalogError({ reason: "size" });
  let low = 0;
  let high = count === 0 ? 0 : Math.min(2000, Math.floor(32_000 / count));
  // Exact serialization accounts for escaped control characters in transcript text.
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (JSON.stringify(applyLimit(middle)).length <= 60_000) low = middle;
    else high = middle - 1;
  }
  return applyLimit(low);
}

export async function loadRoutingCandidates(boxRoot: string): Promise<RoutingCandidate[]> {
  // A failed source invalidates the whole catalog; never route from partial discovery.
  const [sessions, { summaries, problems }, rubric] = await Promise.all([
    loadAllSessions(boxRoot), loadLandmarkSummaries(boxRoot), loadRoutingRubric(boxRoot),
  ]);
  if (problems.length > 0) throw new RoutingCatalogError({ reason: "landmarks" });
  const candidates = buildRoutingCandidates({ sessions, landmarks: summaries, rubric, now: getBoxTime(boxRoot).getTime() });
  boundRoutingContexts(candidates); // Reject oversized metadata before reading transcripts.
  // Provider-owned histories may use RPC. Bound the evidence sent to Jev.
  for (const candidate of candidates) {
    if (candidate.target.kind !== "existing-session") continue;
    const history = await loadSessionHistory(boxRoot, { sessionId: candidate.target.sessionId, slice: { mode: "tail", tail: 12 } });
    const text = history.entries.filter((entry) => entry.type === "user" || entry.type === "assistant")
      .map((entry) => `${entry.type}: ${entry.content.filter((block) => block.type === "text").map((block) => block.text ?? "").join("\n")}`)
      .join("\n");
    candidate.recentContext = text.slice(-2000);
    candidate.contextTruncated = text.length > 2000 || history.total > history.entries.length;
  }
  return boundRoutingContexts(candidates);
}
