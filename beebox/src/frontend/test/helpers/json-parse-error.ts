/**
 * The runtime's own message for text that is not JSON. It differs between Node
 * versions, so a test that expects a log line carrying it asks the runtime
 * instead of copying the wording.
 */
export function jsonParseMessage(raw: string): string {
  try {
    JSON.parse(raw);
  } catch (error) {
    if (error instanceof Error) return error.message;
  }
  throw new Error(`${raw} is valid JSON`);
}
