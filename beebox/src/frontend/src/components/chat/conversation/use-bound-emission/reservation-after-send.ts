import type { Receipt } from "../../../../input/targets/receipts";

/**
 * Whether a settled send into a reserved chat retires this tab's reservation
 * receipt. Once a send may have reached the box, missing history no longer
 * proves the chat unused, and re-reserving could recreate a used (possibly
 * deleted) chat. A definitive refusal recorded nothing, so the receipt still
 * proves an empty chat and a retry may start it.
 */
export function sendSpendsReservation(receipt: Receipt): boolean {
  return !(receipt.disposition === "rejected" && receipt.definitive === true);
}
