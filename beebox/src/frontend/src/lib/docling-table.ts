/**
 * Reconstructing a docling table's cell grid from `table_cells`.
 *
 * Split out of `docling.ts` (which sits at the module's 300-line budget) —
 * this is a self-contained concern: docling gives every cell half-open
 * row/column offsets, and the grid is built by placing each cell at its
 * start offset. Only imports the `DoclingTableCell` type back from
 * `docling.ts`, so the two files don't form a runtime import cycle.
 */

import { isRecord } from "@shared/is-record";
import type { DoclingTableCell } from "./docling";

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function int(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Hard bound on a reconstructed table's row/column offsets — past it, a cell
 * offset (e.g. a hostile `start_row_offset_idx: 1e9`) would make
 * `Array.from({ length: rowCount })` below allocate an enormous array.
 * Docling's own tables never approach this.
 */
const MAX_TABLE_ROWS = 512;
const MAX_TABLE_COLS = 512;

/**
 * Build a table's grid from `data.table_cells`. Spanned positions are left
 * out rather than duplicated (`colSpan`/`rowSpan` carry them into the
 * rendered `<td>`).
 *
 * Returns `[]` for anything we can't read (renders as a placeholder), or
 * `"too-large"` past {@link MAX_TABLE_ROWS}/{@link MAX_TABLE_COLS} — the
 * caller counts that table as unrecognized instead of sizing a grid off a
 * hostile offset.
 */
export function readTableRows(data: unknown): DoclingTableCell[][] | "too-large" {
  if (!isRecord(data)) return [];
  const cells = array(data["table_cells"]).filter(isRecord);
  const placements: Array<{ row: number; col: number; cell: DoclingTableCell }> = [];
  for (const cell of cells) {
    const row = int(cell["start_row_offset_idx"]);
    const col = int(cell["start_col_offset_idx"]);
    if (row === null || col === null || row < 0 || col < 0) continue;
    if (row >= MAX_TABLE_ROWS || col >= MAX_TABLE_COLS) return "too-large";
    const endRow = int(cell["end_row_offset_idx"]) ?? row + 1;
    const endCol = int(cell["end_col_offset_idx"]) ?? col + 1;
    placements.push({
      row,
      col,
      cell: {
        text: str(cell["text"]) ?? "",
        rowSpan: Math.max(1, endRow - row),
        colSpan: Math.max(1, endCol - col),
        header: cell["column_header"] === true || cell["row_header"] === true,
      },
    });
  }
  if (placements.length === 0) return [];
  const rowCount = Math.max(...placements.map((p) => p.row)) + 1;
  const rows: DoclingTableCell[][] = Array.from({ length: rowCount }, () => []);
  for (const placement of placements.toSorted((a, b) => a.row - b.row || a.col - b.col)) {
    rows[placement.row]?.push(placement.cell);
  }
  return rows;
}
