/**
 * Read-only spreadsheet grid. Renders a 2D array of cell values with a
 * sticky row-number column and A/B/C column headers. Formula cells display
 * their computed value with the formula text in a tooltip.
 *
 * A rendered-content table (`Table variant="grid"`); the sticky header row
 * and row-number column are the spreadsheet's own, added here.
 */

import { cn } from "../lib/cn";
import { Table, Td, Th } from "./ui/Table";
import { Text } from "./ui/Text";
import { VisuallyHidden } from "./ui/VisuallyHidden";

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
  /** The table's name for screen readers: the sheet tab's title. */
  caption: string;
}

export function SheetTable({ rows, caption }: SheetTableProps) {
  if (rows.length === 0) {
    return <Text size="sm" tone="muted" italic>Empty sheet</Text>;
  }

  const maxCols = Math.max(...rows.map((r) => r.length));

  // One scroll container (the Table's wrapper): the row-number column sticks
  // to its left edge and the header row to its top.
  return (
    <Table variant="grid" scroll="both" caption={caption} captionHidden className="text-xs font-mono">
      <thead>
        <tr className="sticky top-0 z-10">
          <Th scope="col" numeric className="sticky left-0 z-20 w-10">
            <VisuallyHidden>Row</VisuallyHidden>
          </Th>
          {Array.from({ length: maxCols }, (_, i) => (
            <Th key={i} scope="col" className="text-center min-w-[60px]">
              {columnLetter(i)}
            </Th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, rowIdx) => (
          <tr key={rowIdx} className="hover:bg-warm-50">
            <Th scope="row" numeric className="sticky left-0">
              {rowIdx + 1}
            </Th>
            {Array.from({ length: maxCols }, (_, colIdx) => {
              // `?? ""` covers two real absences: a null CellValue cell, and
              // a ragged row shorter than maxCols (`.at()`, unlike `[colIdx]`,
              // is typed `T | undefined` even without noUncheckedIndexedAccess).
              const cell = row.at(colIdx) ?? "";
              const formula = isFormulaCell(cell);
              const display = formula ? cell.v : String(cell);
              return (
                <Td
                  key={colIdx}
                  className={cn("whitespace-pre-wrap", formula ? "text-primary" : "text-warm-900")}
                  title={formula ? cell.f : undefined}
                >
                  {display}
                </Td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
