/** Evaluate Gmail query rules against bounded mailbox-change candidates. */

import type { GmailMessage, GoogleGmailService } from "../services/google-gmail.js";
import type { ConnectorProcedureTrigger } from "./index.js";
import type { GmailConnectorConfig, GmailRule } from "./gmail-config.js";
import { messageIdFor, summarizeGmailMessage } from "./gmail-mime.js";
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

async function establishBaseline(opts: {
  service: GoogleGmailService;
  rule: GmailRule;
  state: GmailTransientState;
  nowIso: string;
}): Promise<GmailTransientState> {
  const result = await opts.service.listThreads({ q: opts.rule.query, maxResults: 1 });
  const additionalMatches = result.resultSizeEstimate ?? result.threads.length;
  return setRuleState({
    state: opts.state,
    ruleName: opts.rule.name,
    ruleState: {
      ...stateForRule(opts.state, opts.rule.name),
      baselineAt: opts.nowIso,
      additionalMatches,
    },
  });
}

function rfcQuery(message: GmailMessage, rule: GmailRule): string {
  const messageId = messageIdFor(message).replaceAll(/[<>]/g, "");
  return `(${rule.query}) rfc822msgid:${messageId}`;
}

async function matchesRule(opts: {
  service: GoogleGmailService;
  message: GmailMessage;
  rule: GmailRule;
}): Promise<boolean> {
  const result = await opts.service.listMessages({
    q: rfcQuery(opts.message, opts.rule),
    maxResults: 1,
  });
  return result.messages.some((ref) => ref.id === opts.message.id);
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
  const handledRuleThreads = new Set<string>();
  for (const message of opts.candidates) {
    for (const rule of activeRules) {
      const ruleThreadKey = `${rule.name}\0${message.threadId}`;
      if (handledRuleThreads.has(ruleThreadKey)) continue;
      if (!(await matchesRule({ service: opts.service, message, rule }))) continue;
      handledRuleThreads.add(ruleThreadKey);
      let ruleState = stateForRule(state, rule.name);
      switch (rule.action.type) {
        case "track": {
          if (opts.trackedThreadIds.has(message.threadId)) break;
          const tracking = automaticTrack({
            rule,
            ruleState,
            threadId: message.threadId,
            now: opts.now,
            selected,
          });
          ruleState = tracking.ruleState;
          if (tracking.selected) {
            selected.add(message.threadId);
            trackRequests.push({ threadId: message.threadId, ruleName: rule.name });
          } else if (!selected.has(message.threadId)) {
            ruleState = addPending({
              ruleState,
              summary: pendingSummary({ message, labelMap: opts.labelMap, nowIso: opts.now.toISOString() }),
            });
            ruleState.additionalMatches = (ruleState.additionalMatches ?? 0) + 1;
          }
          break;
        }
        case "procedure":
          ruleState = addPending({
            ruleState,
            summary: pendingSummary({ message, labelMap: opts.labelMap, nowIso: opts.now.toISOString() }),
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
