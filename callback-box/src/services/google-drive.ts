/**
 * Google Drive service — typed interface for Drive and Sheets API operations.
 *
 * Real implementation calls REST APIs with an access token from GoogleAuthService.
 * Fake maintains in-memory spreadsheets for testing.
 */

import ky, { type KyInstance } from "ky";
import type { GoogleAuthService } from "./google-auth.js";
import { validateResponse } from "./connector-response.js";
import {
  driveGetFileSchema,
  driveFileListSchema,
  spreadsheetMetadataSchema,
  sheetValuesSchema,
  documentStructureSchema,
  driveCommentListSchema,
} from "./google-drive-schemas.js";

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

function createAuthedApi(prefixUrl: string, auth: GoogleAuthService): KyInstance {
  return ky.create({
    prefixUrl,
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
}

export function createGoogleDriveService(auth: GoogleAuthService): GoogleDriveService {
  const driveApi = createAuthedApi("https://www.googleapis.com/drive/v3", auth);
  const sheetsApi = createAuthedApi("https://sheets.googleapis.com/v4", auth);
  const docsApi = createAuthedApi("https://docs.googleapis.com/v1", auth);
  const uploadApi = createAuthedApi("https://www.googleapis.com/upload/drive/v3", auth);

  return {
    async getFile(fileId) {
      const data = await driveApi
        .get(`files/${encodeURIComponent(fileId)}`, {
          searchParams: {
            fields: "id,name,mimeType,modifiedTime,owners(emailAddress,displayName),parents,webViewLink",
          },
        })
        .json<DriveFile>();
      validateResponse(data, { schema: driveGetFileSchema, service: "drive", operation: "getFile" });
      return data;
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
        validateResponse(data, { schema: driveFileListSchema, service: "drive", operation: "listFiles" });
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
        validateResponse(data, { schema: driveFileListSchema, service: "drive", operation: "listSpreadsheets" });
        if (data.files) items.push(...data.files);
        pageToken = data.nextPageToken;
      } while (pageToken);
      return items;
    },

    async getSpreadsheet(fileId) {
      const data = await sheetsApi
        .get(`spreadsheets/${encodeURIComponent(fileId)}`, {
          searchParams: {
            fields: "spreadsheetId,properties.title,sheets.properties(sheetId,title)",
          },
        })
        .json<SpreadsheetMetadata>();
      validateResponse(data, { schema: spreadsheetMetadataSchema, service: "drive", operation: "getSpreadsheet" });
      return data;
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
      validateResponse(data, { schema: sheetValuesSchema, service: "drive", operation: "getSheetValues" });
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
      const data = await docsApi
        .get(`documents/${encodeURIComponent(fileId)}`)
        .json<DocumentStructure>();
      validateResponse(data, { schema: documentStructureSchema, service: "drive", operation: "getDocument" });
      return data;
    },

    async listComments(fileId) {
      const items: DriveComment[] = [];
      let pageToken: string | undefined;
      do {
        const searchParams: Record<string, string> = {
          fields:
            "nextPageToken,comments(id,content,author(displayName,emailAddress),resolved," +
            "createdTime,modifiedTime,quotedFileContent(mimeType,value)," +
            "replies(id,content,author(displayName,emailAddress),createdTime,modifiedTime))",
          pageSize: "100",
        };
        if (pageToken) searchParams["pageToken"] = pageToken;
        const data = await driveApi
          .get(`files/${encodeURIComponent(fileId)}/comments`, { searchParams })
          .json<{ comments?: DriveComment[]; nextPageToken?: string }>();
        validateResponse(data, { schema: driveCommentListSchema, service: "drive", operation: "listComments" });
        if (data.comments) items.push(...data.comments);
        pageToken = data.nextPageToken;
      } while (pageToken);
      return items;
    },
  };
}

// ─── Fake implementation ────────────────────────────────────────────────────

// The in-memory fake lives in a sibling module; re-export it so the public
// surface of this module (and `services/index.ts`) is unchanged.
export type {
  FakeSpreadsheet,
  FakeDocument,
  FakeGoogleDriveOptions,
  FakeGoogleDriveService,
} from "./google-drive-fake.js";
export { createFakeGoogleDrive } from "./google-drive-fake.js";
