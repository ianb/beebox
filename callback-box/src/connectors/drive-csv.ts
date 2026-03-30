/**
 * CSV utilities for Google Drive sheet sync.
 *
 * Converts between Google Sheets 2D arrays (string[][]) and RFC 4180 CSV text.
 * Formulas are preserved as-is (e.g., "=SUM(A1:A10)").
 */

/**
 * Convert a 2D array of cell values to CSV text.
 *
 * Follows RFC 4180: fields containing commas, double quotes, or newlines
 * are quoted. Double quotes inside quoted fields are escaped as "".
 */
export function valuesToCsv(rows: string[][]): string {
  return rows.map((row) => row.map(quoteField).join(",")).join("\n") + "\n";
}

/**
 * Parse CSV text back to a 2D array of cell values.
 *
 * Handles quoted fields, escaped double quotes, and embedded newlines.
 */
export function csvToValues(csv: string): string[][] {
  const rows: string[][] = [];
  let current = "";
  let inQuotes = false;
  let row: string[] = [];

  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i]!;

    if (inQuotes) {
      if (ch === '"') {
        // Check for escaped quote
        if (i + 1 < csv.length && csv[i + 1] === '"') {
          current += '"';
          i++; // skip the second quote
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        row.push(current);
        current = "";
      } else if (ch === "\r") {
        // Skip carriage return, handle \r\n as just \n
      } else if (ch === "\n") {
        row.push(current);
        current = "";
        rows.push(row);
        row = [];
      } else {
        current += ch;
      }
    }
  }

  // Handle last field/row (file may not end with newline)
  if (current.length > 0 || row.length > 0) {
    row.push(current);
    rows.push(row);
  }

  return rows;
}

function quoteField(value: string): string {
  if (
    value.includes(",") ||
    value.includes('"') ||
    value.includes("\n") ||
    value.includes("\r")
  ) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}
