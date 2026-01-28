/**
 * Provenance information for tracking source locations.
 */
export interface Provenance {
  /** Source file or identifier */
  source: string;
  /** Starting line number (1-based) */
  startLine: number;
  /** Starting column number (1-based) */
  startColumn: number;
  /** Ending line number (1-based) */
  endLine: number;
  /** Ending column number (1-based) */
  endColumn: number;
}

/**
 * Comment information attached to an element.
 */
export interface Comments {
  /** Comment text appearing before the element */
  before?: string;
  /** Comment text appearing after the element */
  after?: string;
}

/**
 * A text segment in mixed content (text interspersed with elements).
 */
export interface TextSegment {
  /** The text content */
  text: string;
  /** Position in the original node order (for serialization) */
  position: number;
}

/**
 * An element node in the parsed XML structure.
 */
export interface ElementNode {
  /** The tag name of the element */
  tagName: string;
  /** Attributes as key-value pairs */
  attrs: Record<string, string>;
  /** Comments associated with this element */
  comments: Comments;
  /** Text content (for leaf nodes or dedented content) */
  text?: string;
  /** Text segments for mixed content */
  textSegments?: TextSegment[];
  /** Child element nodes */
  children: ElementNode[];
  /** Source location information */
  provenance: Provenance;
  /** Whether this node has been modified since parsing */
  dirty: boolean;
}

/**
 * Create an empty provenance object.
 */
export function emptyProvenance(source: string): Provenance {
  return {
    source,
    startLine: 0,
    startColumn: 0,
    endLine: 0,
    endColumn: 0,
  };
}
