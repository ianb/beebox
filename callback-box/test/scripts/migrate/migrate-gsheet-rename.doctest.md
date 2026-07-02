# Migration: rename `sheet` card type to `gsheet`

`scripts/migrate/gsheet-rename.ts` renames every `*.sheet.card` to `*.gsheet.card`
(the type comes from the filename, so the rename *is* the type change) and
rewrites inbound `.sheet.card` references to `.gsheet.card`. `rewriteSheetRefs(text)`
is the pure ref-rewrite entry point.

```ts setup
import { rewriteSheetRefs } from "../../../scripts/migrate/gsheet-rename.js";
```

## A markdown link to a sheet card is rewritten

```ts
rewriteSheetRefs("See [the tracker](store/drive/Rent.sheet.card) for rents.")
=> See [the tracker](store/drive/Rent.gsheet.card) for rents.
```

## Multiple references in one file all rewrite

```ts
rewriteSheetRefs("a/X.sheet.card and b/Y.sheet.card")
=> a/X.gsheet.card and b/Y.gsheet.card
```

## A box-root-absolute ref and a bare prose mention both rewrite

```ts
rewriteSheetRefs("ref: /store/Budget.sheet.card — the Budget.sheet.card file")
=> ref: /store/Budget.gsheet.card — the Budget.gsheet.card file
```

## Text with no sheet reference is unchanged (idempotent second run)

```ts
rewriteSheetRefs("Nothing here refers to a spreadsheet card.")
=> Nothing here refers to a spreadsheet card.

rewriteSheetRefs(rewriteSheetRefs("a/X.sheet.card"))
=> a/X.gsheet.card
```

## Only the `.sheet.card` suffix is touched — the word "sheet" alone is safe

```ts
rewriteSheetRefs("A spreadsheet, a Google Sheet, a sheet-tab — none are .card refs.")
=> A spreadsheet, a Google Sheet, a sheet-tab — none are .card refs.
```
