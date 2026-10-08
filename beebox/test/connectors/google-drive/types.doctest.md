# Drive Types — URL Parsing

Tests for extracting Google Drive file IDs from various URL formats.

```ts setup
import { extractDriveFileId } from "../../../src/connectors/google-drive/types.js";
```

## Google Sheets, Docs, Slides and Drive file URLs

All four carry the ID in a `/d/<id>/` segment.

```ts
extractDriveFileId("https://docs.google.com/spreadsheets/d/1aBcDeFgHiJkLmNoPqRsT/edit#gid=0")
=> 1aBcDeFgHiJkLmNoPqRsT
```

## Drive open URL with query param

```ts
extractDriveFileId("https://drive.google.com/open?id=1aBcDeFgHiJkLmNoPqRsT")
=> 1aBcDeFgHiJkLmNoPqRsT
```

## Bare file ID

```ts
extractDriveFileId("1aBcDeFgHiJkLmNoPqRsT")
=> 1aBcDeFgHiJkLmNoPqRsT
```

## Short string is not a file ID

```ts
extractDriveFileId("abc")
=> null
```

## Random URL is not a file ID

```ts
extractDriveFileId("https://example.com/page")
=> null
```
