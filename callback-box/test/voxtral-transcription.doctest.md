# Voxtral transcription helpers

The Voxtral non-streaming API occasionally returns `text` with
sentence-end + next-sentence concatenated without a space ("have
gone.Generic tools"). `repairMissingSentenceSpaces` inserts the
missing space so the agent sees readable prose, while leaving
decimals, ellipses, and other non-letter sequences alone.

```ts setup
import { repairMissingSentenceSpaces } from "../src/core/transcription-voxtral.js";
```

## The bug case — sentence-end followed by a letter

```
repairMissingSentenceSpaces("It went the way a lot of these things have gone.Generic tools were better.")
=> It went the way a lot of these things have gone. Generic tools were better.

repairMissingSentenceSpaces("Where I said elements, it's actually LLMs.see how that goes.")
=> Where I said elements, it's actually LLMs. see how that goes.

repairMissingSentenceSpaces("Yes!What?Maybe.Now go.")
=> Yes! What? Maybe. Now go.
```

## Don't break decimals or ellipses

```
repairMissingSentenceSpaces("Version 1.2 released")
=> Version 1.2 released

repairMissingSentenceSpaces("Wait... what?")
=> Wait... what?

repairMissingSentenceSpaces("The price is $9.99")
=> The price is $9.99
```

## Already-spaced text is untouched

```
repairMissingSentenceSpaces("One sentence. Another sentence.")
=> One sentence. Another sentence.
```
