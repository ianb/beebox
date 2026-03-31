# Drive Sheet Data

Tests for the JSON sheet data format — building, serializing, parsing, and extracting values.

```ts setup
import { buildSheetData, serializeSheetData, parseSheetData, sheetDataToValues, isFormulaCell } from "../src/connectors/drive-sheet-data.js";
```

## Build sheet data from formula + formatted values

Plain cells stay as bare values. Formula cells become `{f, v}` objects:

```
const formula = [["Name", "Amount"], ["Alice", "100"], ["Total", "=SUM(B2:B2)"]];
const formatted = [["Name", "Amount"], ["Alice", "100"], ["Total", "$100.00"]];
const data = buildSheetData(formula, formatted);

JSON.stringify(data[0])
=> ["Name","Amount"]

JSON.stringify(data[2])
=> ["Total",{"f":"=SUM(B2:B2)","v":"$100.00"}]
```

## Numeric values are preserved as numbers

```
const formula = [["Price"], ["42.5"]];
const formatted = [["Price"], ["$42.50"]];
const data = buildSheetData(formula, formatted);
typeof data[1]?.[0]
=> number

data[1]?.[0]
=> 42.5
```

## Serialization — one row per line

```
const data = [["A", "B"], [1, {"f": "=A2+1", "v": "2"}]];
const json = serializeSheetData(data);
json
=> [
["A","B"],
[1,{"f":"=A2+1","v":"2"}]
]
```

## Round-trip: serialize then parse

```
const original = [["Name", 100], ["", {"f": "=SUM(B1)", "v": "100"}]];
const json = serializeSheetData(original);
const parsed = parseSheetData(json);
JSON.stringify(parsed)
=> [["Name",100],["",{"f":"=SUM(B1)","v":"100"}]]
```

## Extract values for push — formulas become formula strings

```
const data = [["Name", 100], ["Total", {"f": "=SUM(B1)", "v": "100"}]];
const values = sheetDataToValues(data);
JSON.stringify(values)
=> [["Name","100"],["Total","=SUM(B1)"]]
```

## isFormulaCell helper

```
isFormulaCell({"f": "=SUM(A1)", "v": "42"})
=> true

isFormulaCell("hello")
=> false

isFormulaCell(42)
=> false

isFormulaCell(null)
=> false
```
