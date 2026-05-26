# Path Utilities

Utilities for working with card filenames and callback box directory structure.

```ts setup
import { parseCardName, buildCardName, isCardFile, BOX_DIRS } from "../src/cli/lib/paths.js";
```

## Card filenames

Card files follow the pattern `Name.type.card`. The name can contain dots, but the type is always the last segment before `.card`.

```
parseCardName("Test.memo.card")
=>
{
  "name": "Test",
  "type": "memo"
}
```

Compound types work — the type is everything between the last dot-separated segment and `.card`:

```
parseCardName("Meeting_Tomorrow.email-thread.card")
=>
{
  "name": "Meeting_Tomorrow",
  "type": "email-thread"
}
```

Returns `null` for strings that aren't valid card filenames:

```
parseCardName("invalid.card")
=> null

parseCardName("no-extension")
=> null

parseCardName("only.card")
=> null
```

## Building card filenames

`buildCardName` is the inverse of `parseCardName`:

```
buildCardName("Test", "memo")
=> Test.memo.card

buildCardName("Meeting_Tomorrow", "email-thread")
=> Meeting_Tomorrow.email-thread.card
```

## Checking card files

`isCardFile` is a simple extension check — any path ending in `.card`:

```
isCardFile("Test.memo.card")
=> true

isCardFile("/path/to/Test.memo.card")
=> true

isCardFile("Test.memo")
=> false

isCardFile("Test.card.bak")
=> false
```

## Box directory constants

`BOX_DIRS` defines the standard directory layout of a callback box:

```
BOX_DIRS.inbox
=> box/inbox

BOX_DIRS.questions
=> box/questions

BOX_DIRS.archiveDone
=> store/archive/done
```
