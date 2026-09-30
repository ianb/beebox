/** Outcome labels need a cited human answer, never confidence or silence. */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { createHash } from "node:crypto";
import { splitCardContent } from "../../../exports/cards.js";
import { parseRef } from "../../../shared/ref-path/core.js";
import { getBoxTimeISO } from "../../../lib/time.js";
import { withFileLock } from "../../../lib/file-lock.js";
import { errnoCode } from "../../../shared/error-guards.js";
import { withBoxGitLock, stageAndCommitPaths } from "../../../lib/git/core.js";
import { listChatHusks } from "../../chat/husk-read.js";
import { loadSessionHistory } from "../../chat/session/load-history.js";
import { isRealUserMessage } from "../../../cli/lib/session.js";
import { readDecisionReceipt, saveDecisionReceipt, containedPath, receiptRef, withDecisionReceiptLock, TriageReceiptError, type DecisionReceipt } from "./storage.js";
import { applyDecision } from "./apply.js";

const answeredQuestion = z.object({ "answered-at": z.string().datetime({ offset: true }), "answered-via": z.enum(["web", "cli"]).optional(), answer: z.object({ text: z.string().optional(), selected: z.string().optional() }) });
async function humanTurn(boxRoot: string, ref: string): Promise<string> {
  const parsed = parseRef(ref);
  if (!parsed.fragment || !parsed.path.endsWith(".chat.card")) throw new TriageReceiptError({ detail: "Human source must be a chat.card#turn-id reference" });
  const abs = containedPath(boxRoot, parsed.path);
  const husk = (await listChatHusks(boxRoot)).find((h) => path.join(boxRoot, h.path) === abs);
  if (!husk) throw new TriageReceiptError({ detail: "Human source chat was not found" });
  let offset = 0;
  for (;;) {
    const history = await loadSessionHistory(boxRoot, { sessionId: husk.session, slice: { mode: "page", offset, limit: 200 }, fresh: true });
    const entry = history.entries.find((e) => e.uuid === parsed.fragment);
    if (entry) {
      if (!isRealUserMessage(entry)) throw new TriageReceiptError({ detail: "Cited turn was not authored by a human" });
      return entry.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
    }
    offset += 200;
    if (offset >= history.total) throw new TriageReceiptError({ detail: "Cited human turn is unavailable" });
  }
}
async function sourceAssertion(boxRoot: string, opts: { sourceRef: string; userTurnRef?: string }): Promise<{ actor: "user" | "agent" | "unknown"; selected?: string; userText?: string }> {
  if (parseRef(opts.sourceRef).path.endsWith(".chat.card")) return { actor: "user", userText: await humanTurn(boxRoot, opts.sourceRef) };
  if (!opts.sourceRef.endsWith(".question.card")) throw new TriageReceiptError({ detail: "Confirmation needs an answered question or actual user chat turn" });
  const split = splitCardContent(await fs.readFile(containedPath(boxRoot, opts.sourceRef), "utf8"));
  const question = answeredQuestion.parse(parseYaml(split.frontmatterText));
  const via = question["answered-via"];
  const userText = opts.userTurnRef ? await humanTurn(boxRoot, opts.userTurnRef) : undefined;
  return { actor: via === "web" || opts.userTurnRef ? "user" : via === "cli" ? "agent" : "unknown", ...(question.answer.selected ? { selected: question.answer.selected } : {}), ...(userText === undefined ? {} : { userText }) };
}
function namesDestination(text: string, value: string): boolean {
  const haystack = [...text.toLowerCase()];
  const needle = [...value.toLowerCase()];
  for (let start = 0; start <= haystack.length - needle.length; start++) {
    if (!needle.every((character, offset) => haystack[start + offset] === character)) continue;
    const before = haystack[start - 1];
    const after = haystack[start + needle.length];
    if ((before === undefined || !/[\p{L}\p{N}_]/u.test(before)) && (after === undefined || !/[\p{L}\p{N}_]/u.test(after))) return true;
  }
  return false;
}
function userTextSupportsDestination(text: string, destination: { ref: string; name: string }): boolean {
  return namesDestination(text, destination.ref) || namesDestination(text, destination.name);
}
export async function confirmDecision(opts: { boxRoot: string; id: string; sourceRef: string; label: string; userTurnRef?: string }): Promise<DecisionReceipt> {
  const assertion = await sourceAssertion(opts.boxRoot, opts);
  return withDecisionReceiptLock({ boxRoot: opts.boxRoot, id: opts.id, fn: () => withBoxGitLock(opts.boxRoot, async () => {
    const receipt = await readDecisionReceipt(opts.boxRoot, opts.id);
    const destination = receipt.instructions.destinations.find((d) => d.ref === opts.label);
    if (!destination) throw new TriageReceiptError({ detail: "Outcome must name a destination in the evaluated snapshot" });
    if (assertion.actor === "user" && assertion.selected && assertion.selected !== destination.optionId) throw new TriageReceiptError({ detail: "User confirmation needs outcome-matching selected-answer evidence" });
    if (assertion.actor === "user" && !assertion.selected && !(assertion.userText && userTextSupportsDestination(assertion.userText, destination))) throw new TriageReceiptError({ detail: `Cited user turn must explicitly name ${destination.name} or ${destination.ref}` });
    if (assertion.selected && assertion.selected !== destination.optionId) throw new TriageReceiptError({ detail: "Selected question answer does not support the supplied outcome" });
    receipt.outcomes.push({ label: opts.label, actor: assertion.actor, sourceRef: opts.userTurnRef ?? opts.sourceRef, at: getBoxTimeISO(opts.boxRoot) });
    await saveDecisionReceipt(opts.boxRoot, receipt);
    await stageAndCommitPaths(opts.boxRoot, { paths: [path.relative(opts.boxRoot, containedPath(opts.boxRoot, receiptRef(opts.id)))], message: `Record triage outcome ${opts.id}`, trailers: { "Triage-Decision": opts.id, "Triage-Outcome": opts.label, "Triage-Outcome-Actor": assertion.actor } });
    return receipt;
  }) });
}
export async function correctDecision(opts: { boxRoot: string; id: string; questionRef: string; userTurnRef?: string }): Promise<DecisionReceipt> {
  const lockPath = path.join(opts.boxRoot, ".beebox/locks", `triage-correction-${opts.id}`);
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  return withFileLock({ lockPath, metadata: { decision: opts.id }, waitMs: 10_000 }, async () => {
    const previous = await readDecisionReceipt(opts.boxRoot, opts.id);
    if (previous.application.questionRef !== opts.questionRef) throw new TriageReceiptError({ detail: "Question does not belong to this triage decision" });
    const assertion = await sourceAssertion(opts.boxRoot, { sourceRef: opts.questionRef, ...(opts.userTurnRef ? { userTurnRef: opts.userTurnRef } : {}) });
    const destination = previous.instructions.destinations.find((d) => d.optionId === assertion.selected);
    if (!destination) throw new TriageReceiptError({ detail: "Free-text correction requires grounded research and a new decision; no arbitrary path will be executed" });
    const digest = createHash("sha256").update(`${previous.id}\0${opts.questionRef}\0${destination.optionId}`).digest("hex").slice(0, 32).split("");
    digest[12] = "5";
    digest[16] = ((parseInt(digest[16] ?? "0", 16) & 3) | 8).toString(16);
    const correctionId = `${digest.slice(0, 8).join("")}-${digest.slice(8, 12).join("")}-${digest.slice(12, 16).join("")}-${digest.slice(16, 20).join("")}-${digest.slice(20).join("")}`;
    let existing: DecisionReceipt | null = null;
    try { existing = await readDecisionReceipt(opts.boxRoot, correctionId); }
    catch (error) { if (errnoCode(error) !== "ENOENT") throw error; }
    if (existing) return applyDecision({ boxRoot: opts.boxRoot, decision: correctionId });
    const receipt: DecisionReceipt = { ...previous, id: correctionId, at: getBoxTimeISO(opts.boxRoot), originalDecisionId: previous.id, resolution: { destinationRef: destination.ref, sourceRef: opts.questionRef, actor: assertion.actor }, application: { state: "pending", from: previous.application.to, to: `/_content/inbox/triaged/${destination.name}/${path.basename(previous.application.to)}` }, outcomes: [{ label: destination.ref, actor: assertion.actor, sourceRef: opts.userTurnRef ?? opts.questionRef, at: getBoxTimeISO(opts.boxRoot) }] };
    delete receipt.provenanceRepair;
    return applyDecision({ boxRoot: opts.boxRoot, decision: receipt });
  });
}
