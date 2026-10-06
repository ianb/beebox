/** Automated knowledge-audit checks over normalized agent behavior. */

import type { AgentBehavior, AutomatedChecks, AuditTest } from "./test-runner/runner.js";
import type { SearchWhere } from "./test-suite-schema.js";

interface RunChecksContext {
  behavior: AgentBehavior;
  newOrModifiedCards: Map<string, string>;
}

export function runChecks(
  test: AuditTest,
  { behavior, newOrModifiedCards }: RunChecksContext,
): AutomatedChecks {
  const containsChecks = (test.correct_contains ?? []).map((expected) => ({
    expected,
    found: behavior.responseText.toLowerCase().includes(expected.toLowerCase()),
  }));
  const matchesChecks = (test.correct_matches ?? []).map((pattern) => {
    // eslint-disable-next-line security/detect-non-literal-regexp -- authored in committed audit YAML
    const match = new RegExp(pattern, "i").exec(behavior.responseText);
    return { pattern, found: match !== null, ...(match && { matched: match[0] }) };
  });
  const notContainsChecks = (test.response_not_contains ?? []).map((forbidden) => ({
    forbidden,
    found: behavior.responseText.toLowerCase().includes(forbidden.toLowerCase()),
  }));
  const notMatchesChecks = (test.response_not_matches ?? []).map((pattern) => {
    // eslint-disable-next-line security/detect-non-literal-regexp -- authored in committed audit YAML
    const match = new RegExp(pattern, "i").exec(behavior.responseText);
    return { pattern, found: match !== null, ...(match && { matched: match[0] }) };
  });
  let containsAnyCheck: AutomatedChecks["containsAnyCheck"];
  if (test.correct_contains_any) {
    const lowerText = behavior.responseText.toLowerCase();
    const matched = test.correct_contains_any.find((opt) => lowerText.includes(opt.toLowerCase()));
    containsAnyCheck = { options: test.correct_contains_any, found: !!matched, matched: matched ?? undefined };
  }
  const cardsContainChecks = (test.cards_contain ?? []).map((expected) => {
    const lowerExpected = expected.toLowerCase();
    for (const [filePath, content] of newOrModifiedCards) {
      if (content.toLowerCase().includes(lowerExpected)) return { expected, found: true, foundIn: filePath };
    }
    return { expected, found: false };
  });
  const cardsNotUnderChecks = (test.cards_not_under ?? []).map((prefix) => {
    const normalized = prefix.replace(/^\.?\//, "");
    for (const filePath of newOrModifiedCards.keys()) {
      if (filePath.replace(/^\.?\//, "").startsWith(normalized)) return { prefix, found: true, foundAt: filePath };
    }
    return { prefix, found: false };
  });
  const shouldReadChecks = (test.should_read ?? []).map((file) => ({
    file,
    wasRead: behavior.filesRead.some((read) => read.includes(file)),
  }));
  let shouldReadAnyCheck: AutomatedChecks["shouldReadAnyCheck"];
  if (test.should_read_any !== undefined) {
    const matched = test.should_read_any.find((file) => behavior.filesRead.some((read) => read.includes(file)));
    shouldReadAnyCheck = { files: test.should_read_any, wasRead: matched !== undefined, matched };
  }
  const shouldNotReadChecks = (test.should_not_read ?? []).map((file) => ({
    file,
    wasRead: behavior.filesRead.some((read) => read.includes(file)),
  }));
  const bashContainsChecks = (test.bash_contains ?? []).map((expected) => {
    const matched = behavior.bashRawCommands.find((command) =>
      command.toLowerCase().includes(expected.toLowerCase()));
    return { expected, found: !!matched, ...(matched && { matchedCommand: matched }) };
  });
  return {
    ...(test.should_search !== undefined && { shouldSearchCheck: checkSearch(test.should_search, behavior) }),
    containsChecks,
    matchesChecks,
    notContainsChecks,
    notMatchesChecks,
    containsAnyCheck,
    cardsContainChecks,
    cardsNotUnderChecks,
    shouldReadChecks,
    shouldReadAnyCheck,
    shouldNotReadChecks,
    bashContainsChecks,
  };
}

export function automatedChecksPassed(checks: AutomatedChecks): boolean {
  return checks.containsChecks.every((check) => check.found) &&
    checks.matchesChecks.every((check) => check.found) &&
    checks.notContainsChecks.every((check) => !check.found) &&
    checks.notMatchesChecks.every((check) => !check.found) &&
    (checks.containsAnyCheck?.found ?? true) &&
    checks.cardsContainChecks.every((check) => check.found) &&
    checks.cardsNotUnderChecks.every((check) => !check.found) &&
    checks.shouldReadChecks.every((check) => check.wasRead) &&
    (checks.shouldReadAnyCheck?.wasRead ?? true) &&
    checks.shouldNotReadChecks.every((check) => !check.wasRead) &&
    checks.bashContainsChecks.every((check) => check.found) &&
    (checks.shouldSearchCheck?.found ?? true);
}

const WEB_SEARCH_TOOLS = new Set(["WebSearch", "WebFetch"]);
const BOX_SEARCH_COMMAND = /\bbbx\s+search\b/i;

/**
 * Did the agent look something up where the audit asks? A web lookup is a
 * WebSearch or WebFetch in `searches` (both runners record provider searches
 * under that tool name); a box lookup is a `bbx search` shell command.
 */
function checkSearch(where: SearchWhere, behavior: AgentBehavior): NonNullable<AutomatedChecks["shouldSearchCheck"]> {
  const web = behavior.searches.find((search) => WEB_SEARCH_TOOLS.has(search.tool));
  const box = behavior.bashRawCommands.find((command) => BOX_SEARCH_COMMAND.test(command));
  const webMatch = web && `${web.tool} ${web.summary}`;
  const byWhere: Record<SearchWhere, string | undefined> = { web: webMatch, box, any: webMatch ?? box };
  const matched = byWhere[where];
  return { where, found: matched !== undefined, ...(matched !== undefined && { matched }) };
}
