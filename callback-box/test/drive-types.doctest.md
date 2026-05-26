# Drive Types — URL Parsing

Tests for extracting Google Drive file IDs from various URL formats.

```ts setup
import { extractDriveFileId } from "../src/connectors/drive-types.js";
```

## Google Sheets URL

```
extractDriveFileId("https://docs.google.com/spreadsheets/d/1aBcDeFgHiJkLmNoPqRsT/edit#gid=0")
=> 1aBcDeFgHiJkLmNoPqRsT
```

## Google Docs URL

```
extractDriveFileId("https://docs.google.com/document/d/1aBcDeFgHiJkLmNoPqRsT/edit")
=> 1aBcDeFgHiJkLmNoPqRsT
```

## Google Slides URL

```
extractDriveFileId("https://docs.google.com/presentation/d/1aBcDeFgHiJkLmNoPqRsT/edit")
=> 1aBcDeFgHiJkLmNoPqRsT
```

## Drive file URL

```
extractDriveFileId("https://drive.google.com/file/d/1aBcDeFgHiJkLmNoPqRsT/view")
=> 1aBcDeFgHiJkLmNoPqRsT
```

## Drive open URL with query param

```
extractDriveFileId("https://drive.google.com/open?id=1aBcDeFgHiJkLmNoPqRsT")
=> 1aBcDeFgHiJkLmNoPqRsT
```

## Bare file ID

```
extractDriveFileId("1aBcDeFgHiJkLmNoPqRsT")
=> 1aBcDeFgHiJkLmNoPqRsT
```

## Short string is not a file ID

```
extractDriveFileId("abc")
=> null
```

## Random URL is not a file ID

```
extractDriveFileId("https://example.com/page")
=> null
```
