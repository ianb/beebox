/**
 * Google Drive service — typed interface for Drive and Sheets API operations.
 *
 * Real implementation calls REST APIs with an access token from GoogleAuthService.
 * Fake maintains in-memory spreadsheets for testing.
 */

import ky from "ky";
import type { GoogleAuthService } from "./google-auth.js";

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
  };
}

// ─── Fake implementation ────────────────────────────────────────────────────

export interface FakeSpreadsheet {
  metadata: SpreadsheetMetadata;
  sheets: Map<string, string[][]>;
}

export interface FakeGoogleDriveOptions {
  files?: DriveFile[];
  spreadsheets?: Map<string, FakeSpreadsheet>;
}

export interface FakeGoogleDriveService extends GoogleDriveService {
  files: DriveFile[];
  spreadsheets: Map<string, FakeSpreadsheet>;
  updateLog: Array<{ fileId: string; sheetTitle: string; values: string[][] }>;
}

export function createFakeGoogleDrive(
  opts?: FakeGoogleDriveOptions,
): FakeGoogleDriveService {
  const fake: FakeGoogleDriveService = {
    files: opts?.files ? [...opts.files] : [],
    spreadsheets: opts?.spreadsheets ? new Map(opts.spreadsheets) : new Map(),
    updateLog: [],

    async getFile(fileId) {
      const file = fake.files.find((f) => f.id === fileId);
      if (!file) throw new Error(`File not found: ${fileId}`);
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
      if (!ss) throw new Error(`Spreadsheet not found: ${fileId}`);
      return ss.metadata;
    },

    async getSheetValues(fileId, sheetOpts) {
      const ss = fake.spreadsheets.get(fileId);
      if (!ss) throw new Error(`Spreadsheet not found: ${fileId}`);
      const values = ss.sheets.get(sheetOpts.sheetTitle);
      if (!values) throw new Error(`Sheet not found: ${sheetOpts.sheetTitle}`);
      return values;
    },

    async updateSheetValues(fileId, updateOpts) {
      const ss = fake.spreadsheets.get(fileId);
      if (!ss) throw new Error(`Spreadsheet not found: ${fileId}`);
      ss.sheets.set(updateOpts.sheetTitle, updateOpts.values);
      fake.updateLog.push({
        fileId,
        sheetTitle: updateOpts.sheetTitle,
        values: updateOpts.values,
      });
    },
  };

  return fake;
}
