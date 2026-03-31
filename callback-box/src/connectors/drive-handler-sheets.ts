/**
 * Drive type handler for Google Sheets (spreadsheets).
 *
 * Exports sheets as JSON files (one per tab) with formula + computed values.
 * Detects local edits via content hash and pushes changes back.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { safeFilename } from "./chat-utils.js";
import {
  buildSheetData,
  serializeSheetData,
  parseSheetData,
  sheetDataToValues,
} from "./drive-sheet-data.js";
import type {
  DriveTypeHandler,
  InspectResult,
  PullResult,
  PushResult,
} from "./drive-types.js";
import { registerDriveHandler } from "./drive-types.js";
import type { GoogleDriveService, DriveFile } from "../services/google-drive.js";
import { createSheetTemplate } from "../schemas/sheet.js";

function contentHash(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
}

const sheetsHandler: DriveTypeHandler = {
  mimeTypes: ["application/vnd.google-apps.spreadsheet"],
  cardType: "sheet",

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

    // Ensure data directory exists
    await fs.mkdir(localDir, { recursive: true });

    const sheetRefs: Array<{ file: string; title: string; gid: string }> = [];

    for (const sheet of spreadsheet.sheets) {
      const tabTitle = sheet.properties.title;
      const gid = String(sheet.properties.sheetId);
      const safeName = safeFilename(tabTitle, "sheet");
      const jsonFileName = `${safeName}.json`;
      const jsonPath = path.join(localDir, jsonFileName);
      const jsonRelPath = path.relative(path.dirname(cardPath), jsonPath);

      sheetRefs.push({ file: jsonRelPath, title: tabTitle, gid });

      // Fetch formula values and formatted values
      const formulaValues = await service.getSheetValues(file.id, {
        sheetTitle: tabTitle,
        valueRenderOption: "FORMULA",
      });
      const formattedValues = await service.getSheetValues(file.id, {
        sheetTitle: tabTitle,
        valueRenderOption: "FORMATTED_VALUE",
      });

      const sheetData = buildSheetData(formulaValues, formattedValues);
      const jsonContent = serializeSheetData(sheetData);
      const newHash = contentHash(jsonContent);
      const storedHash = state.contentHashes[jsonRelPath];

      if (storedHash) {
        // Check if local file was edited
        let localContent = "";
        try {
          localContent = await fs.readFile(jsonPath, "utf-8");
        } catch {
          // File missing — will be written below
        }
        const localHash = contentHash(localContent);

        if (localHash !== storedHash) {
          // Local edit detected — skip overwriting, push will handle it
          continue;
        }
      }

      // Write JSON if content changed
      if (newHash !== storedHash) {
        await fs.writeFile(jsonPath, jsonContent);
        state.contentHashes[jsonRelPath] = newHash;
        written.push(path.relative(boxRoot, jsonPath));
        changed = true;
      }
    }

    // Clean up tabs that no longer exist in the spreadsheet
    const currentGids = new Set(
      spreadsheet.sheets.map((s) => String(s.properties.sheetId)),
    );
    for (const [relPath, _hash] of Object.entries(state.contentHashes)) {
      const tabGids = (state.extra["tabGids"] ?? {}) as Record<string, string>;
      const gid = tabGids[relPath];
      if (gid && !currentGids.has(gid)) {
        const filePath = path.join(path.dirname(cardPath), relPath);
        try {
          await fs.unlink(filePath);
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
    const cardContent = createSheetTemplate({
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

    const tabGids = (state.extra["tabGids"] ?? {}) as Record<string, string>;

    for (const [relPath, storedHash] of Object.entries(state.contentHashes)) {
      if (!relPath.endsWith(".json")) continue;

      const filePath = path.join(path.dirname(cardPath), relPath);
      let localContent: string;
      try {
        localContent = await fs.readFile(filePath, "utf-8");
      } catch {
        continue;
      }

      const localHash = contentHash(localContent);
      if (localHash === storedHash) continue;

      const gid = tabGids[relPath];
      if (!gid) continue;

      const spreadsheet = await service.getSpreadsheet(file.id);
      const sheet = spreadsheet.sheets.find(
        (s) => String(s.properties.sheetId) === gid,
      );
      if (!sheet) continue;

      const sheetData = parseSheetData(localContent);
      const values = sheetDataToValues(sheetData);
      await service.updateSheetValues(file.id, {
        sheetTitle: sheet.properties.title,
        values,
      });

      state.contentHashes[relPath] = localHash;
      const absPath = path.join(path.dirname(cardPath), relPath);
      pushed.push(path.relative(boxRoot, absPath));
    }

    return { pushed };
  },
};

registerDriveHandler(sheetsHandler);

export { sheetsHandler };
