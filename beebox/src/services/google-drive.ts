/**
 * Google Drive service — typed interface for Drive and Sheets API operations.
 *
 * Real implementation calls REST APIs with an access token from GoogleAuthService.
 * Fake maintains in-memory spreadsheets for testing.
 */

import ky, { type KyInstance } from "ky";
import type { GoogleAuthService } from "./google-auth.js";
import { validateResponse } from "./connector-response.js";
import type {
  DriveComment,
  DriveFile,
  DocumentStructure,
  GoogleDriveService,
  SpreadsheetMetadata,
} from "./google-drive-types.js";
import {
  driveGetFileSchema,
  driveFileListSchema,
  spreadsheetMetadataSchema,
  sheetValuesSchema,
  documentStructureSchema,
  driveCommentListSchema,
} from "./google-drive-schemas.js";

// ─── Types ──────────────────────────────────────────────────────────────────

// The data shapes and the service interface live in the leaf module both this
// real implementation and the in-memory fake import; re-exported here so the
// long-standing `services/google-drive.js` import path keeps working.
export type {
  DriveFile,
  SheetProperties,
  SpreadsheetMetadata,
  DriveComment,
  DriveCommentReply,
  DocumentTextRun,
  DocumentParagraphElement,
  DocumentStructuralElement,
  DocumentStructure,
  GoogleDriveService,
} from "./google-drive-types.js";

// ─── Real implementation ────────────────────────────────────────────────────

/**
 * The `files` resource fields every Drive read here asks for. Requested
 * explicitly because Drive returns only what is named — an unrequested
 * `trashed` comes back absent, not `false`.
 */
const DRIVE_FILE_FIELDS =
  "id,name,mimeType,modifiedTime,trashed,owners(emailAddress,displayName),parents,webViewLink," +
  "shortcutDetails(targetId,targetMimeType)";

/**
 * Shared-drive params. Without them a file or folder that lives on a shared
 * drive is invisible: `getFile` 404s and `listFiles` returns an empty page —
 * a silent wrong answer, not an error.
 * https://developers.google.com/workspace/drive/api/guides/enable-shareddrives
 */
const SHARED_DRIVE_GET = { supportsAllDrives: "true" };
const SHARED_DRIVE_LIST = { supportsAllDrives: "true", includeItemsFromAllDrives: "true" };

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
          searchParams: { fields: DRIVE_FILE_FIELDS, ...SHARED_DRIVE_GET },
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
          fields: `nextPageToken,files(${DRIVE_FILE_FIELDS})`,
          pageSize: "100",
          ...SHARED_DRIVE_LIST,
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
          fields: `nextPageToken,files(${DRIVE_FILE_FIELDS})`,
          pageSize: "100",
          ...SHARED_DRIVE_LIST,
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
