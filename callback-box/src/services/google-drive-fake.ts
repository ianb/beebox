/**
 * In-memory fake of GoogleDriveService for tests.
 *
 * Backed by plain Maps/arrays so tests can prepare files, spreadsheets, and
 * documents up front and observe writes via `updateLog` / `contentUpdateLog`.
 */

import { NotFoundError } from "../lib/errors.js";
import type {
  DriveComment,
  DriveFile,
  DocumentStructure,
  GoogleDriveService,
  SpreadsheetMetadata,
} from "./google-drive-types.js";

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
