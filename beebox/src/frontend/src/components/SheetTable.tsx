/**
 * Read-only spreadsheet grid. Renders a 2D array of cell values with a
 * sticky row-number column and A/B/C column headers. Formula cells display
 * their computed value with the formula text in a tooltip.
 *
 * The table's visual structure (borders, sticky headers, row striping) is
 * specific to the spreadsheet metaphor; keeping it inside components/ lets
 * those appearance classes live alongside the rendering logic.
 */

import { Text } from "./ui/Text";

export interface FormulaCell {
  f: string;
  v: string;
}

export type CellValue = string | number | boolean | null | FormulaCell;

function isFormulaCell(cell: CellValue): cell is FormulaCell {
  return cell !== null && typeof cell === "object" && "f" in cell;
}

function columnLetter(index: number): string {
  let letter = "";
  let n = index;
  while (n >= 0) {
    letter = String.fromCodePoint(65 + (n % 26)) + letter;
    n = Math.floor(n / 26) - 1;
  }
  return letter;
}

export interface SheetTableProps {
  rows: CellValue[][];
}

export function SheetTable({ rows }: SheetTableProps) {
  if (rows.length === 0) {
    return <Text size="sm" tone="muted" italic>Empty sheet</Text>;
  }

  const maxCols = Math.max(...rows.map((r) => r.length));

  return (
    <div className="overflow-auto border border-warm-300 rounded">
      <table className="border-collapse text-xs font-mono w-full">
        <thead>
          <tr className="bg-warm-100 sticky top-0 z-10">
            <th className="border-r border-b border-warm-300 px-2 py-1 text-warm-500 font-normal w-10 text-right sticky left-0 bg-warm-100 z-20">
              {/* row number column header */}
            </th>
            {Array.from({ length: maxCols }, (_, i) => (
              <th
                key={i}
                className="border-r border-b border-warm-300 px-2 py-1 text-warm-500 font-normal text-center min-w-[60px]"
              >
                {columnLetter(i)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIdx) => (
            <tr key={rowIdx} className="hover:bg-warm-50">
              <td className="border-r border-b border-warm-200 px-2 py-1 text-warm-400 text-right bg-warm-50 sticky left-0">
                {rowIdx + 1}
              </td>
              {Array.from({ length: maxCols }, (_, colIdx) => {
                // `?? ""` covers two real absences: a null CellValue cell, and
                // a ragged row shorter than maxCols (`.at()`, unlike `[colIdx]`,
                // is typed `T | undefined` even without noUncheckedIndexedAccess).
                const cell = row.at(colIdx) ?? "";
                const formula = isFormulaCell(cell);
                const display = formula ? cell.v : String(cell);
                return (
                  <td
                    key={colIdx}
                    className={`border-r border-b border-warm-200 px-2 py-1 whitespace-pre-wrap ${formula ? "text-primary" : "text-warm-900"}`}
                    title={formula ? cell.f : undefined}
                  >
                    {display}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
