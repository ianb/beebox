/**
 * Shared types for the Google Drive service.
 *
 * Leaf module: the public data shapes plus the service interface, imported by
 * both the real implementation (`google-drive.ts`) and the in-memory fake
 * (`google-drive-fake.ts`) without forming an import cycle between them.
 */

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  owners?: Array<{ emailAddress: string; displayName?: string }>;
  parents?: string[];
  webViewLink?: string;
}

export interface SheetProperties {
  sheetId: number;
  title: string;
}

export interface SpreadsheetMetadata {
  spreadsheetId: string;
  properties: { title: string };
  sheets: Array<{ properties: SheetProperties }>;
}

export interface DriveComment {
  id: string;
  content: string;
  author?: { displayName?: string; emailAddress?: string };
  resolved?: boolean;
}

/**
 * Narrow shape of the Google Docs API document resource.
 *
 * Only the fields we actually inspect for lossy-content detection.
 * `body.content` is recursive — `table` and `tableOfContents` can themselves
 * contain structural elements — but we only walk the top-level paragraphs
 * for the features we care about (text run equations, suggestion ranges).
 * Other lossy features (footnotes, inline objects) are exposed as keyed
 * dictionaries at the document root.
 */
export interface DocumentTextRun {
  content?: string;
  textStyle?: Record<string, unknown>;
  suggestedInsertionIds?: string[];
  suggestedDeletionIds?: string[];
}

export interface DocumentParagraphElement {
  equation?: unknown;
  inlineObjectElement?: { inlineObjectId: string };
  footnoteReference?: { footnoteId: string };
  textRun?: DocumentTextRun;
}

export interface DocumentStructuralElement {
  paragraph?: { elements?: DocumentParagraphElement[] };
  table?: unknown;
}

export interface DocumentStructure {
  documentId: string;
  title: string;
  revisionId: string;
  body?: { content?: DocumentStructuralElement[] };
  inlineObjects?: Record<string, unknown>;
  footnotes?: Record<string, unknown>;
}

export interface GoogleDriveService {
  /** Get file metadata from Drive API */
  getFile(fileId: string): Promise<DriveFile>;

  /** List files in a folder */
  listFiles(folderId: string): Promise<DriveFile[]>;

  /** List spreadsheets accessible to the user */
  listSpreadsheets(): Promise<DriveFile[]>;

  /** Get spreadsheet metadata (title, sheet tabs) */
  getSpreadsheet(fileId: string): Promise<SpreadsheetMetadata>;

  /** Get cell values from a sheet tab (with formulas by default) */
  getSheetValues(fileId: string, opts: {
    sheetTitle: string;
    valueRenderOption?: string;
  }): Promise<string[][]>;

  /** Update cell values in a sheet tab */
  updateSheetValues(fileId: string, opts: {
    sheetTitle: string;
    values: string[][];
  }): Promise<void>;

  /** Export a Drive file as a given mimeType (e.g. text/markdown for a Doc) */
  exportFile(fileId: string, mimeType: string): Promise<string>;

  /** Replace the content of a Drive file via media upload (auto-converts mimeType) */
  updateFileContent(fileId: string, opts: {
    mimeType: string;
    content: string;
  }): Promise<void>;

  /** Fetch the structured Docs API representation of a Google Doc */
  getDocument(fileId: string): Promise<DocumentStructure>;

  /** List comments on a Drive file */
  listComments(fileId: string): Promise<DriveComment[]>;
}
