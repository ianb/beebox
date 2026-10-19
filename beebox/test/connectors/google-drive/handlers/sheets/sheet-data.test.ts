// # Drive Sheet Data
//
// Tests for the JSON sheet data format — building, serializing, parsing, and extracting values.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { buildSheetData, serializeSheetData, parseSheetData, sheetDataToValues, isFormulaCell } from "../../../../../src/connectors/google-drive/handlers/sheets/sheet-data.js";

// ## Build sheet data from formula + formatted values
//
// Plain cells stay as bare values. Formula cells become `{f, v}` objects:
void test("Plain cells stay as bare values.", async (t) => {
  const formula = [["Name", "Amount"], ["Alice", "100"], ["Total", "=SUM(B2:B2)"]];
  const formatted = [["Name", "Amount"], ["Alice", "100"], ["Total", "$100.00"]];
  const data = buildSheetData(formula, formatted);

  t.check(data[0], [
    "Name",
    "Amount",
  ]);

  t.check(data[2], [
    "Total",
    {
      f: "=SUM(B2:B2)",
      v: "$100.00",
    },
  ]);
});

// ## Numeric values are preserved as numbers
void test("Numeric values are preserved as numbers", async (t) => {
  const formula = [["Price"], ["42.5"]];
  const formatted = [["Price"], ["$42.50"]];
  const data = buildSheetData(formula, formatted);
  t.check(typeof data[1]?.[0], "number");

  t.check(data[1]?.[0], 42.5);
});

// ## Serialization — one row per line
void test("Serialization — one row per line", async (t) => {
  const data = [["A", "B"], [1, {"f": "=A2+1", "v": "2"}]];
  const json = serializeSheetData(data);
  await t.checkText(json, `[
["A","B"],
[1,{"f":"=A2+1","v":"2"}]
]`);
});

// ## Round-trip: serialize then parse
void test("Round-trip: serialize then parse", async (t) => {
  const original = [["Name", 100], ["", {"f": "=SUM(B1)", "v": "100"}]];
  const json = serializeSheetData(original);
  const parsed = parseSheetData(json);
  t.check(parsed, [
    [
      "Name",
      100,
    ],
    [
      "",
      {
        f: "=SUM(B1)",
        v: "100",
      },
    ],
  ]);
});

// ## Extract values for push — formulas become formula strings
void test("Extract values for push — formulas become formula strings", async (t) => {
  const data = [["Name", 100], ["Total", {"f": "=SUM(B1)", "v": "100"}]];
  const values = sheetDataToValues(data);
  t.check(values, [
    [
      "Name",
      "100",
    ],
    [
      "Total",
      "=SUM(B1)",
    ],
  ]);
});

// ## isFormulaCell helper
void test("isFormulaCell helper", async (t) => {
  t.check(isFormulaCell({"f": "=SUM(A1)", "v": "42"}), true);

  t.check(isFormulaCell("hello"), false);

  t.check(isFormulaCell(42), false);

  t.check(isFormulaCell(null), false);
});
