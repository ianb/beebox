/**
 * Sheet data serialization — the JSON format for synced spreadsheet tabs.
 *
 * Plain cells are bare values (string, number, boolean, null).
 * Formula cells are objects: { f: "=SUM(A1:B1)", v: "42" }
 *
 * Files are formatted with one row per line for clean git diffs.
 */

/** A cell that contains a formula */
export interface FormulaCell {
  /** The formula (e.g., "=SUM(A1:B1)") */
  f: string;
  /** The formatted display value (e.g., "$42.00") */
  v: string;
}

/** A single cell value */
export type CellValue = string | number | boolean | null | FormulaCell;

/** A 2D grid of cell values */
export type SheetData = CellValue[][];

/** Check if a cell value is a formula cell */
export function isFormulaCell(cell: CellValue): cell is FormulaCell {
  return cell !== null && typeof cell === "object" && "f" in cell;
}

/**
 * Build SheetData from formula values and formatted values.
 *
 * @param formulaRows - Values fetched with valueRenderOption=FORMULA
 * @param formattedRows - Values fetched with valueRenderOption=FORMATTED_VALUE
 */
export function buildSheetData(formulaRows: string[][], formattedRows: string[][]): SheetData {
  const maxRows = Math.max(formulaRows.length, formattedRows.length);
  const result: SheetData = [];

  for (let r = 0; r < maxRows; r++) {
    const fRow = formulaRows[r] ?? [];
    const vRow = formattedRows[r] ?? [];
    const maxCols = Math.max(fRow.length, vRow.length);
    const row: CellValue[] = [];

    for (let c = 0; c < maxCols; c++) {
      const formula = String(fRow[c] ?? "");
      const formatted = String(vRow[c] ?? "");

      if (formula.startsWith("=")) {
        row.push({ f: formula, v: formatted });
      } else if (formula === "") {
        row.push("");
      } else {
        // Try to preserve numeric types
        const num = Number(formula);
        if (formula !== "" && !Number.isNaN(num) && String(num) === formula) {
          row.push(num);
        } else {
          row.push(formula);
        }
      }
    }

    result.push(row);
  }

  return result;
}

/**
 * Serialize SheetData to JSON with one row per line.
 */
export function serializeSheetData(data: SheetData): string {
  if (data.length === 0) return "[]\n";

  const lines = data.map((row) => JSON.stringify(row));
  return "[\n" + lines.join(",\n") + "\n]\n";
}

/**
 * Parse a sheet data JSON file back to SheetData.
 */
export function parseSheetData(json: string): SheetData {
  return JSON.parse(json);
}

/**
 * Extract editable values from SheetData for pushing back to Sheets API.
 * Formula cells return the formula string; plain cells return the string value.
 */
export function sheetDataToValues(data: SheetData): string[][] {
  return data.map((row) =>
    row.map((cell) => {
      if (isFormulaCell(cell)) return cell.f;
      if (cell === null) return "";
      return String(cell);
    }),
  );
}
