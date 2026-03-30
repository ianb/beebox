# Drive CSV Utilities

Pure function tests for `valuesToCsv` and `csvToValues`.

```ts setup
import { valuesToCsv, csvToValues } from "../src/connectors/drive-csv.js";
```

## Basic round-trip

Simple values survive a round-trip through CSV:

```
const rows = [["Name", "Age"], ["Alice", "30"], ["Bob", "25"]];
const csv = valuesToCsv(rows);
csv
=> Name,Age
Alice,30
Bob,25

JSON.stringify(csvToValues(csv))
=> [["Name","Age"],["Alice","30"],["Bob","25"]]
```

## Fields with commas are quoted

```
const rows = [["Name", "Location"], ["Alice", "Portland, OR"]];
const csv = valuesToCsv(rows);
csv
=> Name,Location
Alice,"Portland, OR"

JSON.stringify(csvToValues(csv))
=> [["Name","Location"],["Alice","Portland, OR"]]
```

## Fields with double quotes are escaped

```
const rows = [["Title"], ['She said "hello"']];
const csv = valuesToCsv(rows);
csv
=> Title
"She said ""hello"""

JSON.stringify(csvToValues(csv))
=> [["Title"],["She said \"hello\""]]
```

## Fields with newlines are quoted

```
const rows = [["Notes"], ["Line 1\nLine 2"]];
const csv = valuesToCsv(rows);
csv
=> Notes
"Line 1
Line 2"

JSON.stringify(csvToValues(csv))
=> [["Notes"],["Line 1\nLine 2"]]
```

## Formulas are preserved

```
const rows = [["A", "B", "Total"], ["10", "20", "=SUM(A1:B1)"]];
const csv = valuesToCsv(rows);
csv
=> A,B,Total
10,20,=SUM(A1:B1)

JSON.stringify(csvToValues(csv))
=> [["A","B","Total"],["10","20","=SUM(A1:B1)"]]
```

## Cross-sheet references in formulas

```
const rows = [["Budget"], ["=Sheet2!A1+Sheet2!B1"]];
const csv = valuesToCsv(rows);
JSON.stringify(csvToValues(csv))
=> [["Budget"],["=Sheet2!A1+Sheet2!B1"]]
```

## Empty cells

```
const rows = [["A", "", "C"], ["", "", ""]];
const csv = valuesToCsv(rows);
csv
=> A,,C
,,

JSON.stringify(csvToValues(csv))
=> [["A","","C"],["","",""]]
```
