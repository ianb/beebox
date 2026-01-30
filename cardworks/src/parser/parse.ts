import { DOMParser } from "@xmldom/xmldom";
import type { ElementNode, Location } from "./provenance.js";
import { domToObject, createLineTracker } from "./dom-to-object.js";

/**
 * Error thrown when XML parsing fails.
 */
export class ParseError extends Error {
  public readonly location: Location;

  constructor(
    message: string,
    source: string,
    line?: number,
    column?: number
  ) {
    const loc = line ? `${source}:${String(line)}:${String(column ?? 1)}` : source;
    super(`${loc}: ${message}`);
    this.name = "ParseError";
    this.location = {
      source,
      startLine: line ?? 0,
      startColumn: column ?? 0,
      endLine: line ?? 0,
      endColumn: column ?? 0,
    };
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

  let doc;
  try {
    doc = parser.parseFromString(xml, "text/xml");
  } catch (e) {
    // xmldom throws directly for fatal errors
    const err = e as Error & { locator?: { lineNumber?: number; columnNumber?: number } };
    return Promise.reject(
      new ParseError(
        err.message,
        source,
        err.locator?.lineNumber,
        err.locator?.columnNumber
      )
    );
  }

  // Check for parsing errors collected by onError
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
  const result = domToObject(root as unknown as Element, tracker, xml);

  // Validate version format if present (version itself is optional)
  const version = result.attrs["version"];
  if (version) {
    const versionPattern = /^\d+\.\d+\.\d+$/;
    if (!versionPattern.test(version)) {
      return Promise.reject(
        new ParseError(
          `Invalid version "${version}" - must be in X.Y.Z format (e.g., "1.0.0")`,
          source,
          result.location.startLine,
          result.location.startColumn
        )
      );
    }
  }

  return Promise.resolve(result);
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
