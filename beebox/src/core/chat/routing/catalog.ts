import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parse as parseYaml, YAMLParseError } from "yaml";
import { z } from "zod";
import { errnoCode } from "../../../lib/error-guards.js";
import { getBoxTime } from "../../../lib/time.js";
import type { SessionEntry } from "../../../cli/lib/session-entry.js";
import { isRealUserMessage } from "../../../cli/lib/session-real-user.js";
import { isCompactionSummary, isPlumbingMessage, stripSpeechWrappers } from "../../../cli/lib/session-text.js";
import { parseRef, resolveRefPath } from "../../../shared/ref-path.js";
import { loadLandmarkSummaries, type LandmarkSummary } from "../../landmark/summaries.js";
import { loadAllSessions, type ChatSessionRow } from "../session/list.js";
import { loadSessionHistory } from "../session/load-history.js";
import { CHAT_FRESH_WINDOW_MS } from "../session/recent-landmark.js";
import type { RoutingCandidate, RoutingRule } from "./policy.js";

const ROUTING_RUBRIC_PATH = "_config/chat-routing.yaml";
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
      overflow: "Too many eligible chats for routing. Copy your text into a chat using Chats.",
      rubric: "Chat routing rubric is invalid. Check _config/chat-routing.yaml.",
      size: "Chat routing rules and destination details exceed the request budget. Shorten the rubric, or copy your text into a chat using Chats.",
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
  if (candidates.length > 255) throw new RoutingCatalogError({ reason: "overflow" });
  return candidates;
}

/** Keep every destination; share the excerpt budget evenly and report shortened evidence. */
export function boundRoutingContexts(candidates: RoutingCandidate[], serializedBudget?: number): RoutingCandidate[] {
  const budget = serializedBudget ?? 60_000;
  const count = candidates.filter(candidate => candidate.target.kind === "existing-session").length;
  const applyLimit = (limit: number) => candidates.map(candidate => {
    if (candidate.target.kind !== "existing-session") return candidate;
    const text = candidate.recentContext ?? "";
    const bounded = boundRecentMessages(text, limit);
    return { ...candidate, recentContext: bounded,
      contextTruncated: candidate.contextTruncated === true || text.length > bounded.length };
  });
  const metadata = applyLimit(0);
  if (JSON.stringify(metadata).length > budget) throw new RoutingCatalogError({ reason: "size" });
  let low = 0;
  let high = count === 0 ? 0 : Math.min(2000, Math.floor(32_000 / count));
  // Exact serialization accounts for escaped control characters in transcript text.
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (JSON.stringify(applyLimit(middle)).length <= budget) low = middle;
    else high = middle - 1;
  }
  return applyLimit(low);
}

/** Keep message boundaries and protect the newest user intent during both budget passes. */
function boundRecentMessages(text: string, limit: number): string {
  if (limit <= 0 || text.length === 0) return "";
  const messages = text.split("\n").filter(Boolean);
  if (messages.join("\n").length <= limit) return messages.join("\n");
  if (!messages.some(message => /^\[[^\]]*] (?:user|assistant):/.test(message))) return text.slice(-limit);
  const newestUser = messages.findLastIndex(message => /^\[[^\]]*] user:/.test(message));
  const newestAssistant = messages.findLastIndex(message => /^\[[^\]]*] assistant:/.test(message));
  const selected = new Set<number>();
  let used = 0;
  const add = (index: number, options?: { mustKeep?: boolean; maxChars?: number }): boolean => {
    const message = messages[index];
    if (message === undefined || selected.has(index)) return true;
    const mustKeep = options?.mustKeep === true;
    const maxChars = options?.maxChars ?? limit;
    const separator = selected.size === 0 ? 0 : 1;
    const allowance = Math.min(limit - used - separator, maxChars);
    const cost = message.length + separator;
    if (cost <= allowance + separator) { selected.add(index); used += cost; return true; }
    else if (mustKeep) {
      const available = Math.max(0, allowance);
      const headerEnd = message.indexOf(": ") + 2;
      const header = message.slice(0, headerEnd);
      const body = message.slice(headerEnd);
      const marker = " …[truncated]";
      const headRoom = Math.max(0, available - header.length - marker.length);
      const excerpt = `${header}${body.slice(0, headRoom)}${marker}`.slice(0, available);
      if (excerpt.length > 0) { messages[index] = excerpt; selected.add(index); used += excerpt.length + separator; return true; }
    }
    return false;
  };
  if (newestUser !== -1) add(newestUser, { mustKeep: true, maxChars: newestAssistant !== -1 ? Math.floor(limit / 2) : limit });
  if (newestAssistant !== -1) add(newestAssistant, { mustKeep: true });
  for (let index = messages.length - 1; index >= 0; index--) if (!add(index)) break;
  return [...selected].toSorted((a, b) => a - b).map(index => messages[index]).filter((message): message is string => message !== undefined).join("\n");
}

function routingConversationEntries(entries: SessionEntry[]): SessionEntry[] {
  const realUsers = entries.filter(isRealUserMessage);
  // Older and some provider transcripts lack typed/speech tags; retain their user text while excluding known injected entries.
  const legacyUsers = entries.filter(entry => entry.type === "user" && routingEntryText(entry)
    && !isPlumbingMessage(routingEntryText(entry)) && !isCompactionSummary(routingEntryText(entry)));
  const userEntries = realUsers.length > 0 ? realUsers : legacyUsers;
  return entries.filter(entry => entry.type === "assistant" || userEntries.includes(entry));
}

function routingEntryText(entry: SessionEntry): string {
  return entry.content.filter(block => block.type === "text")
    .map(block => entry.type === "user" ? stripSpeechWrappers(block.text ?? "") : block.text ?? "")
    .join(" ").replace(/\s+/g, " ").trim();
}

export function formatRecentRoutingContext(entries: SessionEntry[], limit?: number): string {
  const messages = routingConversationEntries(entries)
    .map(entry => {
      const text = routingEntryText(entry);
      return text ? `[${entry.timestamp || "unknown time"}] ${entry.type}: ${text}` : "";
    }).filter(Boolean);
  return boundRecentMessages(messages.join("\n"), limit ?? 2000);
}

export function routingHistoryMetadata(total: number, entries: SessionEntry[]): Pick<RoutingCandidate, "totalEntries" | "lastMessageAt"> {
  const latest = routingConversationEntries(entries).toReversed().find(entry => routingEntryText(entry) && Number.isFinite(Date.parse(entry.timestamp)));
  return {
    totalEntries: total,
    ...(latest ? { lastMessageAt: new Date(latest.timestamp).toISOString() } : {}),
  };
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
    const history = await loadSessionHistory(boxRoot, { sessionId: candidate.target.sessionId, slice: { mode: "tail", tail: 12, minRealUserMessages: 2 } });
    const rawText = formatRecentRoutingContext(history.entries, Number.POSITIVE_INFINITY);
    candidate.recentContext = formatRecentRoutingContext(history.entries);
    candidate.contextTruncated = rawText.length > candidate.recentContext.length || history.total > history.entries.length;
    Object.assign(candidate, routingHistoryMetadata(history.total, history.entries));
  }
  return boundRoutingContexts(candidates);
}
