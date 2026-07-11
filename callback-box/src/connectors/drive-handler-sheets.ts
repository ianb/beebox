/**
 * Drive type handler for Google Sheets (spreadsheets).
 *
 * Exports sheets as JSON files (one per tab) with formula + computed values.
 * Detects local edits via content hash and pushes changes back.
 */

import { contentHash } from "../lib/content-hash.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { errnoCode } from "../lib/error-guards.js";
import { isRecord } from "../lib/is-record.js";
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
import { createGsheetTemplate } from "../schemas/gsheet.js";
import { preserveAgentFields } from "./preserve-agent-fields.js";
import { reconcileCommentsSidecar } from "./drive-comments-sidecar.js";


const sheetsHandler: DriveTypeHandler = {
  mimeTypes: ["application/vnd.google-apps.spreadsheet"],
  cardType: "gsheet",

  async inspect(file: DriveFile, service: GoogleDriveService): Promise<InspectResult> {
    const [spreadsheet, comments] = await Promise.all([
      service.getSpreadsheet(file.id),
      service.listComments(file.id),
    ]);
    const tabs = spreadsheet.sheets.map((s) => ({
      title: s.properties.title,
      gid: s.properties.sheetId,
    }));

    return {
      title: spreadsheet.properties.title,
      mimeType: file.mimeType,
      owner: file.owners?.[0]?.emailAddress ?? "unknown",
      modifiedTime: file.modifiedTime,
      details: { tabs, comments: comments.length },
    };
  },

  async pull(opts): Promise<PullResult> {
    const { file, localDir, cardPath, boxRoot, service, state } = opts;
    const [spreadsheet, comments] = await Promise.all([
      service.getSpreadsheet(file.id),
      service.listComments(file.id),
    ]);
    const written: string[] = [];
    let changed = false;

    // Ensure attach directory exists
    await fs.mkdir(localDir, { recursive: true });

    const sheetRefs: Array<{ ref: string; title: string; gid: string }> = [];

    for (const sheet of spreadsheet.sheets) {
      const tabTitle = sheet.properties.title;
      const gid = String(sheet.properties.sheetId);
      const safeName = safeFilename(tabTitle, "sheet");
      const jsonFileName = `${safeName}.json`;
      const jsonPath = path.join(localDir, jsonFileName);
      // State uses the bare filename within the attach scope as its key; the
      // card ref uses the "attach/" virtual prefix.
      const jsonRelPath = jsonFileName;

      sheetRefs.push({ ref: `attach/${jsonFileName}`, title: tabTitle, gid });

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
        } catch (e) {
          // File missing (or unreadable) — leave localContent empty so it
          // hashes as a mismatch and gets written below; note why we ignored.
          if (errnoCode(e) !== "ENOENT") {
            console.debug(`drive-handler-sheets: could not read ${jsonPath}, treating as absent:`, e);
          }
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
    const existingTabGidsRaw = state.extra["tabGids"];
    const existingTabGids: Record<string, unknown> = isRecord(existingTabGidsRaw) ? existingTabGidsRaw : {};
    for (const [relPath, _hash] of Object.entries(state.contentHashes)) {
      const gid = existingTabGids[relPath];
      if (typeof gid === "string" && !currentGids.has(gid)) {
        const filePath = path.join(localDir, relPath);
        try {
          await fs.unlink(filePath);
        } catch (e) {
          // Cleanup is best-effort — the file may already be gone. Note it
          // but keep deleting the state entry below.
          if (errnoCode(e) !== "ENOENT") {
            console.debug(`drive-handler-sheets: could not unlink stale tab file ${filePath}:`, e);
          }
        }
        delete state.contentHashes[relPath];
        changed = true;
      }
    }

    // Update gid mapping in state, keyed by the bare in-scope filename
    // (matches contentHashes' key shape — push() uses the same).
    const tabGids: Record<string, string> = {};
    for (const r of sheetRefs) {
      const key = r.ref.startsWith("attach/") ? r.ref.slice("attach/".length) : r.ref;
      tabGids[key] = r.gid;
    }
    state.extra["tabGids"] = tabGids;
    state.lastModified = file.modifiedTime;

    // Capture collaborative feedback as a read-only sidecar in the attach
    // scope. Regenerated every pull, never pushed back.
    const cardBasename = path.basename(cardPath, ".gsheet.card");
    const sidecar = await reconcileCommentsSidecar({
      localDir,
      basename: cardBasename,
      comments,
      boxRoot,
    });
    written.push(...sidecar.written);
    if (sidecar.changed) changed = true;

    // Write/update card
    const owner = file.owners?.[0]?.emailAddress ?? "unknown";
    const link = file.webViewLink ?? `https://docs.google.com/spreadsheets/d/${file.id}/edit`;
    const cardContent = createGsheetTemplate({
      driveId: file.id,
      title: spreadsheet.properties.title,
      modified: file.modifiedTime,
      link,
      owner,
      sheets: sheetRefs,
      commentsFile: sidecar.commentsFile,
    });

    let existingCard = "";
    try {
      existingCard = await fs.readFile(cardPath, "utf-8");
    } catch (e) {
      // No card yet (first pull) — leave existingCard empty so the compare
      // below treats it as new and writes it; note why we ignored.
      if (errnoCode(e) !== "ENOENT") {
        console.debug(`drive-handler-sheets: no existing card at ${cardPath}, treating as new:`, e);
      }
    }

    // Re-inject agent-owned fields (contains) before the change comparison,
    // so a card that only differs by preserved fields counts as unchanged.
    const preserved = await preserveAgentFields(cardContent, { existingPath: cardPath });
    if (preserved !== existingCard) {
      await fs.mkdir(path.dirname(cardPath), { recursive: true });
      await fs.writeFile(cardPath, preserved);
      written.push(path.relative(boxRoot, cardPath));
      changed = true;
    }

    return { written, changed };
  },

  async push(opts): Promise<PushResult> {
    const { file, localDir, boxRoot, service, state } = opts;
    const pushed: string[] = [];

    const tabGidsRaw = state.extra["tabGids"];
    const tabGids: Record<string, unknown> = isRecord(tabGidsRaw) ? tabGidsRaw : {};

    for (const [relPath, storedHash] of Object.entries(state.contentHashes)) {
      if (!relPath.endsWith(".json")) continue;

      const filePath = path.join(localDir, relPath);
      let localContent: string;
      try {
        localContent = await fs.readFile(filePath, "utf-8");
      } catch (e) {
        // No local file to push for this tab (deleted/never materialized) —
        // skip it, but note we couldn't read it.
        if (errnoCode(e) !== "ENOENT") {
          console.debug(`drive-handler-sheets: could not read ${filePath} to push, skipping:`, e);
        }
        continue;
      }

      const localHash = contentHash(localContent);
      if (localHash === storedHash) continue;

      const gid = tabGids[relPath];
      if (typeof gid !== "string" || gid === "") continue;

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
      pushed.push(path.relative(boxRoot, filePath));
    }

    return { pushed };
  },
};

registerDriveHandler(sheetsHandler);

export { sheetsHandler };
