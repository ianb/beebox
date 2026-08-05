/**
 * Classify a URL transition away from the fresh-chat sentinel.
 *
 * A fresh chat's machine must survive when the backend assigns that same
 * conversation its durable id. Any other `new` -> id transition is explicit
 * navigation to an existing chat and must remount the machine so its history
 * loads.
 */
export function carriesFreshChatMachine({
  previousSessionInput,
  nextSessionInput,
  announcedAssignment,
}: {
  previousSessionInput: string | null;
  nextSessionInput: string;
  announcedAssignment: string | null;
}): boolean {
  return previousSessionInput === "new"
    && nextSessionInput !== "new"
    && nextSessionInput === announcedAssignment;
}
