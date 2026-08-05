/** Evaluate Gmail query rules against bounded mailbox-change candidates. */

import type { GmailMessage, GoogleGmailService } from "../services/google-gmail.js";
import type { ConnectorProcedureTrigger } from "./index.js";
import type { GmailConnectorConfig, GmailRule } from "./gmail-config.js";
import { rfc822MessageIdFor, summarizeGmailMessage } from "./gmail-mime.js";
import type { GmailPendingSummary, GmailRuleState, GmailTransientState } from "./gmail-state.js";
import { remainingAutomaticTrackingBudget } from "./gmail-tracking.js";
import { assertNever, invariant } from "../lib/invariant.js";

const PENDING_SUMMARY_LIMIT = 50;

export interface GmailAutomaticTrackRequest {
  threadId: string;
  ruleName: string;
}

export interface GmailRuleEvaluation {
  state: GmailTransientState;
  trackRequests: GmailAutomaticTrackRequest[];
  procedures: ConnectorProcedureTrigger[];
}

function stateForRule(state: GmailTransientState, ruleName: string): GmailRuleState {
  return state.rules?.[ruleName] ?? {};
}

function setRuleState(opts: {
  state: GmailTransientState;
  ruleName: string;
  ruleState: GmailRuleState;
}): GmailTransientState {
  return { ...opts.state, rules: { ...opts.state.rules, [opts.ruleName]: opts.ruleState } };
}

function groupCandidatesByThread(candidates: GmailMessage[]): Map<string, GmailMessage[]> {
  const grouped = new Map<string, GmailMessage[]>();
  for (const message of candidates) {
    const messages = grouped.get(message.threadId) ?? [];
    messages.push(message);
    grouped.set(message.threadId, messages);
  }
  return grouped;
}

async function establishBaseline(opts: {
  service: GoogleGmailService;
  rule: GmailRule;
  state: GmailTransientState;
  nowIso: string;
}): Promise<GmailTransientState> {
  const result = await opts.service.listThreads({ q: opts.rule.query, maxResults: 1 });
  const baselineMatches = result.resultSizeEstimate ?? result.threads.length;
  return setRuleState({
    state: opts.state,
    ruleName: opts.rule.name,
    ruleState: {
      ...stateForRule(opts.state, opts.rule.name),
      baselineAt: opts.nowIso,
      baselineMatches,
    },
  });
}

function safeRfc822MessageId(message: GmailMessage): string | null {
  const header = rfc822MessageIdFor(message);
  if (header === undefined) return null;
  const messageId = header.replace(/^<|>$/g, "");
  return /^[\dA-Za-z._%+-]+@[\dA-Za-z.-]+$/u.test(messageId)
    ? messageId
    : null;
}

async function matchesRule(opts: {
  service: GoogleGmailService;
  message: GmailMessage;
  rule: GmailRule;
}): Promise<"match" | "no-match" | "unevaluated"> {
  const messageId = safeRfc822MessageId(opts.message);
  if (messageId === null) return "unevaluated";
  const result = await opts.service.listMessages({
    q: `(${opts.rule.query}) rfc822msgid:${messageId}`,
    maxResults: 1,
  });
  return result.messages.some((ref) => ref.id === opts.message.id) ? "match" : "no-match";
}

async function matchThreadRule(opts: {
  service: GoogleGmailService;
  messages: GmailMessage[];
  rule: GmailRule;
}): Promise<{ result: "match" | "no-match" | "unevaluated"; message: GmailMessage }> {
  let unevaluated: GmailMessage | undefined;
  for (const message of opts.messages) {
    const result = await matchesRule({ service: opts.service, message, rule: opts.rule });
    if (result === "match") return { result, message };
    if (result === "unevaluated") unevaluated ??= message;
  }
  const first = opts.messages[0];
  invariant(first !== undefined, "a candidate thread has at least one message");
  return unevaluated === undefined
    ? { result: "no-match", message: first }
    : { result: "unevaluated", message: unevaluated };
}

function pendingSummary(opts: {
  message: GmailMessage;
  labelMap: Map<string, string>;
  nowIso: string;
}): GmailPendingSummary {
  return {
    ...summarizeGmailMessage(opts.message, opts.labelMap),
    discoveredAt: opts.nowIso,
  };
}

function addPending(opts: {
  ruleState: GmailRuleState;
  summary: GmailPendingSummary;
}): GmailRuleState {
  const previous = (opts.ruleState.pending ?? []).filter(
    (item) => item.threadId !== opts.summary.threadId,
  );
  const all = [opts.summary, ...previous];
  const omitted = Math.max(0, all.length - PENDING_SUMMARY_LIMIT);
  return {
    ...opts.ruleState,
    pending: all.slice(0, PENDING_SUMMARY_LIMIT),
    additionalMatches: (opts.ruleState.additionalMatches ?? 0) + omitted,
  };
}

function addUnevaluated(opts: {
  ruleState: GmailRuleState;
  summary: GmailPendingSummary;
}): GmailRuleState {
  const previous = (opts.ruleState.unevaluated ?? []).filter(
    (item) => item.threadId !== opts.summary.threadId,
  );
  const all = [opts.summary, ...previous];
  const omitted = Math.max(0, all.length - PENDING_SUMMARY_LIMIT);
  return {
    ...opts.ruleState,
    unevaluated: all.slice(0, PENDING_SUMMARY_LIMIT),
    additionalUnevaluated: (opts.ruleState.additionalUnevaluated ?? 0) + omitted,
  };
}

function procedureTrigger(rule: GmailRule): ConnectorProcedureTrigger {
  invariant(rule.action.type === "procedure", "procedure rule required");
  return {
    procedureRef: rule.action.ref,
    directive: `Gmail rule ${rule.name} has new matching mail. Inspect with: cb connector gmail pending ${rule.name}`,
  };
}

function automaticTrack(opts: {
  rule: GmailRule;
  ruleState: GmailRuleState;
  threadId: string;
  now: Date;
  selected: Set<string>;
}): { ruleState: GmailRuleState; selected: boolean } {
  invariant(opts.rule.action.type === "track", "track rule required");
  const status = remainingAutomaticTrackingBudget({
    budget: opts.rule.action.budget,
    events: opts.ruleState.automaticTrackingEvents ?? [],
    now: opts.now,
  });
  if (status.remaining === 0 || opts.selected.has(opts.threadId)) {
    return { ruleState: { ...opts.ruleState, automaticTrackingEvents: status.events }, selected: false };
  }
  return {
    ruleState: {
      ...opts.ruleState,
      automaticTrackingEvents: [...status.events, opts.now.toISOString()],
    },
    selected: true,
  };
}

/** Evaluate configured rules without materializing any thread itself. */
export async function evaluateGmailRules(opts: {
  service: GoogleGmailService;
  config: GmailConnectorConfig;
  state: GmailTransientState;
  candidates: GmailMessage[];
  trackedThreadIds: Set<string>;
  labelMap: Map<string, string>;
  now: Date;
}): Promise<GmailRuleEvaluation> {
  let state = opts.state;
  const activeRules: GmailRule[] = [];
  for (const rule of opts.config.rules) {
    if (stateForRule(state, rule.name).baselineAt === undefined) {
      state = await establishBaseline({
        service: opts.service,
        rule,
        state,
        nowIso: opts.now.toISOString(),
      });
    } else {
      activeRules.push(rule);
    }
  }

  const trackRequests: GmailAutomaticTrackRequest[] = [];
  const procedures = new Map<string, ConnectorProcedureTrigger>();
  const selected = new Set<string>();
  const candidatesByThread = groupCandidatesByThread(opts.candidates);
  for (const messages of candidatesByThread.values()) {
    const first = messages[0];
    invariant(first !== undefined, "a candidate thread has at least one message");
    for (const rule of activeRules) {
      let ruleState = stateForRule(state, rule.name);
      if (rule.action.type === "track" && opts.trackedThreadIds.has(first.threadId)) continue;
      const match = await matchThreadRule({ service: opts.service, messages, rule });
      if (match.result === "no-match") continue;
      if (match.result === "unevaluated") {
        ruleState = addUnevaluated({
          ruleState,
          summary: pendingSummary({
            message: match.message,
            labelMap: opts.labelMap,
            nowIso: opts.now.toISOString(),
          }),
        });
        state = setRuleState({ state, ruleName: rule.name, ruleState });
        continue;
      }
      switch (rule.action.type) {
        case "track": {
          const tracking = automaticTrack({
            rule,
            ruleState,
            threadId: match.message.threadId,
            now: opts.now,
            selected,
          });
          ruleState = tracking.ruleState;
          if (tracking.selected) {
            selected.add(match.message.threadId);
            trackRequests.push({ threadId: match.message.threadId, ruleName: rule.name });
          } else if (!selected.has(match.message.threadId)) {
            ruleState = addPending({
              ruleState,
              summary: pendingSummary({
                message: match.message,
                labelMap: opts.labelMap,
                nowIso: opts.now.toISOString(),
              }),
            });
          }
          break;
        }
        case "procedure":
          ruleState = addPending({
            ruleState,
            summary: pendingSummary({
              message: match.message,
              labelMap: opts.labelMap,
              nowIso: opts.now.toISOString(),
            }),
          });
          procedures.set(rule.name, procedureTrigger(rule));
          break;
        default:
          assertNever(rule.action);
      }
      state = setRuleState({ state, ruleName: rule.name, ruleState });
    }
  }
  return { state, trackRequests, procedures: [...procedures.values()] };
}
