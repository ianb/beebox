/**
 * Drive type handler for Google Sheets (spreadsheets).
 *
 * Exports sheets as CSV files (one per tab, with formulas).
 * Detects local edits via content hash and pushes changes back.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { valuesToCsv, csvToValues } from "./drive-csv.js";
import type {
  DriveTypeHandler,
  InspectResult,
  PullResult,
  PushResult,
} from "./drive-types.js";
import { registerDriveHandler } from "./drive-types.js";
import type { GoogleDriveService, DriveFile } from "../services/google-drive.js";
import { createDriveSheetTemplate } from "../schemas/drive-sheet.js";

function contentHash(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
}

/**
 * Sanitize a sheet tab title for use as a filename.
 * Replaces characters that are invalid in filenames.
 */
function sanitizeTabName(title: string): string {
  return title.replace(/["*/:<>?\\|]/g, "_");
}

const sheetsHandler: DriveTypeHandler = {
  mimeTypes: ["application/vnd.google-apps.spreadsheet"],
  cardType: "drive-sheet",

  async inspect(file: DriveFile, service: GoogleDriveService): Promise<InspectResult> {
    const spreadsheet = await service.getSpreadsheet(file.id);
    const tabs = spreadsheet.sheets.map((s) => ({
      title: s.properties.title,
      gid: s.properties.sheetId,
    }));

    return {
      title: spreadsheet.properties.title,
      mimeType: file.mimeType,
      owner: file.owners?.[0]?.emailAddress ?? "unknown",
      modifiedTime: file.modifiedTime,
      details: { tabs },
    };
  },

  async pull(opts): Promise<PullResult> {
    const { file, localDir, cardPath, boxRoot, service, state } = opts;
    const spreadsheet = await service.getSpreadsheet(file.id);
    const written: string[] = [];
    let changed = false;

    // Ensure CSV directory exists
    await fs.mkdir(localDir, { recursive: true });

    const sheetRefs: Array<{ file: string; title: string; gid: string }> = [];

    for (const sheet of spreadsheet.sheets) {
      const tabTitle = sheet.properties.title;
      const gid = String(sheet.properties.sheetId);
      const safeName = sanitizeTabName(tabTitle);
      const csvFileName = `${safeName}.csv`;
      const csvPath = path.join(localDir, csvFileName);
      const csvRelPath = path.relative(
        path.dirname(cardPath),
        csvPath,
      );

      sheetRefs.push({ file: csvRelPath, title: tabTitle, gid });

      // Fetch values with formulas
      const values = await service.getSheetValues(file.id, {
        sheetTitle: tabTitle,
        valueRenderOption: "FORMULA",
      });

      const csvContent = valuesToCsv(values);
      const newHash = contentHash(csvContent);
      const storedHash = state.contentHashes[csvRelPath];

      if (storedHash) {
        // Check if local file was edited
        let localContent = "";
        try {
          localContent = await fs.readFile(csvPath, "utf-8");
        } catch {
          // File missing — will be written below
        }
        const localHash = contentHash(localContent);

        if (localHash !== storedHash) {
          // Local edit detected — skip overwriting, push will handle it
          continue;
        }
      }

      // Write CSV if content changed
      if (newHash !== storedHash) {
        await fs.writeFile(csvPath, csvContent);
        state.contentHashes[csvRelPath] = newHash;
        written.push(path.relative(boxRoot, csvPath));
        changed = true;
      }
    }

    // Clean up tabs that no longer exist in the spreadsheet
    const currentGids = new Set(
      spreadsheet.sheets.map((s) => String(s.properties.sheetId)),
    );
    for (const [relPath, _hash] of Object.entries(state.contentHashes)) {
      // Find the gid from state.extra
      const tabGids = (state.extra["tabGids"] ?? {}) as Record<string, string>;
      const gid = tabGids[relPath];
      if (gid && !currentGids.has(gid)) {
        // Tab was removed — delete local CSV
        const csvPath = path.join(path.dirname(cardPath), relPath);
        try {
          await fs.unlink(csvPath);
        } catch {
          // Already gone
        }
        delete state.contentHashes[relPath];
        changed = true;
      }
    }

    // Update gid mapping in state
    const tabGids: Record<string, string> = {};
    for (const ref of sheetRefs) {
      tabGids[ref.file] = ref.gid;
    }
    state.extra["tabGids"] = tabGids;
    state.lastModified = file.modifiedTime;

    // Write/update card
    const owner = file.owners?.[0]?.emailAddress ?? "unknown";
    const link = file.webViewLink ?? `https://docs.google.com/spreadsheets/d/${file.id}/edit`;
    const cardContent = createDriveSheetTemplate({
      driveId: file.id,
      title: spreadsheet.properties.title,
      modified: file.modifiedTime,
      link,
      owner,
      sheets: sheetRefs,
    });

    let existingCard = "";
    try {
      existingCard = await fs.readFile(cardPath, "utf-8");
    } catch {
      // New card
    }

    if (cardContent !== existingCard) {
      await fs.mkdir(path.dirname(cardPath), { recursive: true });
      await fs.writeFile(cardPath, cardContent);
      written.push(path.relative(boxRoot, cardPath));
      changed = true;
    }

    return { written, changed };
  },

  async push(opts): Promise<PushResult> {
    const { file, cardPath, boxRoot, service, state } = opts;
    const pushed: string[] = [];

    // Check each CSV for local edits
    const tabGids = (state.extra["tabGids"] ?? {}) as Record<string, string>;

    for (const [relPath, storedHash] of Object.entries(state.contentHashes)) {
      if (!relPath.endsWith(".csv")) continue;

      const csvPath = path.join(path.dirname(cardPath), relPath);
      let localContent: string;
      try {
        localContent = await fs.readFile(csvPath, "utf-8");
      } catch {
        continue; // File missing
      }

      const localHash = contentHash(localContent);
      if (localHash === storedHash) continue; // No change

      // Find the tab title from the gid mapping
      const gid = tabGids[relPath];
      if (!gid) continue;

      // Find tab title from spreadsheet metadata
      const spreadsheet = await service.getSpreadsheet(file.id);
      const sheet = spreadsheet.sheets.find(
        (s) => String(s.properties.sheetId) === gid,
      );
      if (!sheet) continue;

      const values = csvToValues(localContent);
      await service.updateSheetValues(file.id, {
        sheetTitle: sheet.properties.title,
        values,
      });

      // Update stored hash to reflect pushed content
      state.contentHashes[relPath] = localHash;
      const csvAbsPath = path.join(path.dirname(cardPath), relPath);
      pushed.push(path.relative(boxRoot, csvAbsPath));
    }

    return { pushed };
  },
};

// Self-register on import
registerDriveHandler(sheetsHandler);

export { sheetsHandler };
