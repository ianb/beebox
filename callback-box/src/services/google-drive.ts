/**
 * Google Drive service — typed interface for Drive and Sheets API operations.
 *
 * Real implementation calls REST APIs with an access token from GoogleAuthService.
 * Fake maintains in-memory spreadsheets for testing.
 */

import ky from "ky";
import type { GoogleAuthService } from "./google-auth.js";
import { NotFoundError } from "../lib/errors.js";

class NoExportForMimeTypeError extends Error {
  readonly mimeType: string;
  readonly fileId: string;
  constructor(mimeType: string, fileId: string) {
    super(`No export for mimeType ${mimeType} on ${fileId}`);
    this.name = "NoExportForMimeTypeError";
    this.mimeType = mimeType;
    this.fileId = fileId;
  }
}

// ─── Types ──────────────────────────────────────────────────────────────────

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

// ─── Service interface ──────────────────────────────────────────────────────

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

// ─── Real implementation ────────────────────────────────────────────────────

export function createGoogleDriveService(auth: GoogleAuthService): GoogleDriveService {
  const driveApi = ky.create({
    prefixUrl: "https://www.googleapis.com/drive/v3",
    retry: 2,
    hooks: {
      beforeRequest: [
        async (request) => {
          const token = await auth.getAccessToken();
          request.headers.set("Authorization", `Bearer ${token}`);
        },
      ],
    },
  });

  const sheetsApi = ky.create({
    prefixUrl: "https://sheets.googleapis.com/v4",
    retry: 2,
    hooks: {
      beforeRequest: [
        async (request) => {
          const token = await auth.getAccessToken();
          request.headers.set("Authorization", `Bearer ${token}`);
        },
      ],
    },
  });

  const docsApi = ky.create({
    prefixUrl: "https://docs.googleapis.com/v1",
    retry: 2,
    hooks: {
      beforeRequest: [
        async (request) => {
          const token = await auth.getAccessToken();
          request.headers.set("Authorization", `Bearer ${token}`);
        },
      ],
    },
  });

  const uploadApi = ky.create({
    prefixUrl: "https://www.googleapis.com/upload/drive/v3",
    retry: 2,
    hooks: {
      beforeRequest: [
        async (request) => {
          const token = await auth.getAccessToken();
          request.headers.set("Authorization", `Bearer ${token}`);
        },
      ],
    },
  });

  return {
    async getFile(fileId) {
      return driveApi
        .get(`files/${encodeURIComponent(fileId)}`, {
          searchParams: {
            fields: "id,name,mimeType,modifiedTime,owners(emailAddress,displayName),parents,webViewLink",
          },
        })
        .json<DriveFile>();
    },

    async listFiles(folderId) {
      const items: DriveFile[] = [];
      let pageToken: string | undefined;
      do {
        const searchParams: Record<string, string> = {
          q: `'${folderId}' in parents and trashed = false`,
          fields: "nextPageToken,files(id,name,mimeType,modifiedTime,owners(emailAddress,displayName),parents,webViewLink)",
          pageSize: "100",
        };
        if (pageToken) searchParams["pageToken"] = pageToken;
        const data = await driveApi
          .get("files", { searchParams })
          .json<{ files?: DriveFile[]; nextPageToken?: string }>();
        if (data.files) items.push(...data.files);
        pageToken = data.nextPageToken;
      } while (pageToken);
      return items;
    },

    async listSpreadsheets() {
      const items: DriveFile[] = [];
      let pageToken: string | undefined;
      do {
        const searchParams: Record<string, string> = {
          q: "mimeType='application/vnd.google-apps.spreadsheet' and trashed = false",
          fields: "nextPageToken,files(id,name,mimeType,modifiedTime,owners(emailAddress,displayName),parents,webViewLink)",
          pageSize: "100",
        };
        if (pageToken) searchParams["pageToken"] = pageToken;
        const data = await driveApi
          .get("files", { searchParams })
          .json<{ files?: DriveFile[]; nextPageToken?: string }>();
        if (data.files) items.push(...data.files);
        pageToken = data.nextPageToken;
      } while (pageToken);
      return items;
    },

    async getSpreadsheet(fileId) {
      return sheetsApi
        .get(`spreadsheets/${encodeURIComponent(fileId)}`, {
          searchParams: {
            fields: "spreadsheetId,properties.title,sheets.properties(sheetId,title)",
          },
        })
        .json<SpreadsheetMetadata>();
    },

    async getSheetValues(fileId, opts) {
      const renderOption = opts.valueRenderOption || "FORMULA";
      const data = await sheetsApi
        .get(
          `spreadsheets/${encodeURIComponent(fileId)}/values/${encodeURIComponent(opts.sheetTitle)}`,
          {
            searchParams: { valueRenderOption: renderOption },
          },
        )
        .json<{ values?: string[][] }>();
      return data.values || [];
    },

    async updateSheetValues(fileId, opts) {
      await sheetsApi.put(
        `spreadsheets/${encodeURIComponent(fileId)}/values/${encodeURIComponent(opts.sheetTitle)}`,
        {
          searchParams: { valueInputOption: "USER_ENTERED" },
          json: { values: opts.values },
        },
      );
    },

    async exportFile(fileId, mimeType) {
      const response = await driveApi.get(
        `files/${encodeURIComponent(fileId)}/export`,
        { searchParams: { mimeType } },
      );
      return response.text();
    },

    async updateFileContent(fileId, opts) {
      await uploadApi.patch(`files/${encodeURIComponent(fileId)}`, {
        searchParams: { uploadType: "media" },
        body: opts.content,
        headers: { "Content-Type": opts.mimeType },
      });
    },

    async getDocument(fileId) {
      return docsApi
        .get(`documents/${encodeURIComponent(fileId)}`)
        .json<DocumentStructure>();
    },

    async listComments(fileId) {
      const items: DriveComment[] = [];
      let pageToken: string | undefined;
      do {
        const searchParams: Record<string, string> = {
          fields: "nextPageToken,comments(id,content,author(displayName,emailAddress),resolved)",
          pageSize: "100",
        };
        if (pageToken) searchParams["pageToken"] = pageToken;
        const data = await driveApi
          .get(`files/${encodeURIComponent(fileId)}/comments`, { searchParams })
          .json<{ comments?: DriveComment[]; nextPageToken?: string }>();
        if (data.comments) items.push(...data.comments);
        pageToken = data.nextPageToken;
      } while (pageToken);
      return items;
    },
  };
}

// ─── Fake implementation ────────────────────────────────────────────────────

export interface FakeSpreadsheet {
  metadata: SpreadsheetMetadata;
  sheets: Map<string, string[][]>;
}

/**
 * In-memory representation of a Google Doc for fakes.
 *
 * `exports` maps mimeType → content so tests can prepare the markdown body
 * the connector will pull. `structure` is what `getDocument()` returns —
 * tests populate `inlineObjects`, `footnotes`, etc. to exercise lossy
 * detection. `revisionId` and `modifiedTime` change on every
 * `updateFileContent` so conflict detection works.
 */
export interface FakeDocument {
  structure: DocumentStructure;
  exports: Map<string, string>;
  comments: DriveComment[];
}

export interface FakeGoogleDriveOptions {
  files?: DriveFile[];
  spreadsheets?: Map<string, FakeSpreadsheet>;
  documents?: Map<string, FakeDocument>;
}

export interface FakeGoogleDriveService extends GoogleDriveService {
  files: DriveFile[];
  spreadsheets: Map<string, FakeSpreadsheet>;
  documents: Map<string, FakeDocument>;
  updateLog: Array<{ fileId: string; sheetTitle: string; values: string[][] }>;
  contentUpdateLog: Array<{ fileId: string; mimeType: string; content: string }>;
}

export function createFakeGoogleDrive(
  opts?: FakeGoogleDriveOptions,
): FakeGoogleDriveService {
  const fake: FakeGoogleDriveService = {
    files: opts?.files ? [...opts.files] : [],
    spreadsheets: opts?.spreadsheets ? new Map(opts.spreadsheets) : new Map(),
    documents: opts?.documents ? new Map(opts.documents) : new Map(),
    updateLog: [],
    contentUpdateLog: [],

    async getFile(fileId) {
      const file = fake.files.find((f) => f.id === fileId);
      if (!file) throw new NotFoundError(fileId, "File");
      return file;
    },

    async listFiles(folderId) {
      return fake.files.filter(
        (f) => f.parents && f.parents.includes(folderId),
      );
    },

    async listSpreadsheets() {
      return fake.files.filter(
        (f) => f.mimeType === "application/vnd.google-apps.spreadsheet",
      );
    },

    async getSpreadsheet(fileId) {
      const ss = fake.spreadsheets.get(fileId);
      if (!ss) throw new NotFoundError(fileId, "Spreadsheet");
      return ss.metadata;
    },

    async getSheetValues(fileId, sheetOpts) {
      const ss = fake.spreadsheets.get(fileId);
      if (!ss) throw new NotFoundError(fileId, "Spreadsheet");
      const values = ss.sheets.get(sheetOpts.sheetTitle);
      if (!values) throw new NotFoundError(sheetOpts.sheetTitle, "Sheet");
      return values;
    },

    async updateSheetValues(fileId, updateOpts) {
      const ss = fake.spreadsheets.get(fileId);
      if (!ss) throw new NotFoundError(fileId, "Spreadsheet");
      ss.sheets.set(updateOpts.sheetTitle, updateOpts.values);
      fake.updateLog.push({
        fileId,
        sheetTitle: updateOpts.sheetTitle,
        values: updateOpts.values,
      });
    },

    async exportFile(fileId, mimeType) {
      const doc = fake.documents.get(fileId);
      if (!doc) throw new NotFoundError(fileId, "Document");
      const content = doc.exports.get(mimeType);
      if (content === undefined) {
        throw new NoExportForMimeTypeError(mimeType, fileId);
      }
      return content;
    },

    async updateFileContent(fileId, updateOpts) {
      const doc = fake.documents.get(fileId);
      if (!doc) throw new NotFoundError(fileId, "Document");
      doc.exports.set(updateOpts.mimeType, updateOpts.content);
      doc.structure.revisionId = `rev-${Date.now()}-${fake.contentUpdateLog.length + 1}`;
      const file = fake.files.find((f) => f.id === fileId);
      if (file) file.modifiedTime = new Date().toISOString();
      fake.contentUpdateLog.push({
        fileId,
        mimeType: updateOpts.mimeType,
        content: updateOpts.content,
      });
    },

    async getDocument(fileId) {
      const doc = fake.documents.get(fileId);
      if (!doc) throw new NotFoundError(fileId, "Document");
      return doc.structure;
    },

    async listComments(fileId) {
      const doc = fake.documents.get(fileId);
      return doc ? [...doc.comments] : [];
    },
  };

  return fake;
}
