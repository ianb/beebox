import { DOMParser } from "@xmldom/xmldom";
import type { ElementNode } from "./provenance.js";
import { domToObject, createLineTracker } from "./dom-to-object.js";

/**
 * Error thrown when XML parsing fails.
 */
export class ParseError extends Error {
  constructor(
    message: string,
    public readonly source: string,
    public readonly line?: number,
    public readonly column?: number
  ) {
    super(message);
    this.name = "ParseError";
  }
}

/**
 * Parse XML content into an ElementNode tree.
 *
 * @param xml - The XML string to parse
 * @param source - Source identifier for location tracking
 * @returns The parsed ElementNode tree
 * @throws ParseError if the XML is malformed
 */
export function parseXml(xml: string, source: string): Promise<ElementNode> {
  const errors: Array<{ message: string; line?: number; column?: number }> = [];

  const parser = new DOMParser({
    onError: (level, msg): void => {
      if (level === "warning") {
        // Ignore warnings
        return;
      }
      errors.push({ message: msg });
    },
  });

  const doc = parser.parseFromString(xml, "text/xml");

  // Check for parsing errors
  if (errors.length > 0) {
    const firstError = errors[0];
    return Promise.reject(
      new ParseError(
        firstError?.message ?? "Unknown parse error",
        source,
        firstError?.line,
        firstError?.column
      )
    );
  }

  // Find the root element
  const root = doc.documentElement;
  if (!root) {
    return Promise.reject(new ParseError("No root element found", source));
  }

  // Create line tracker for location
  const tracker = createLineTracker(xml, source);

  // Transform to our object model
  // Cast the xmldom Element to our expected interface
  return Promise.resolve(
    domToObject(root as unknown as Element, tracker, xml)
  );
}

/**
 * Parse XML from a file using a filesystem.
 */
export async function parseXmlFile(
  fs: { read(path: string): Promise<string> },
  path: string
): Promise<ElementNode> {
  const content = await fs.read(path);
  return parseXml(content, path);
}
