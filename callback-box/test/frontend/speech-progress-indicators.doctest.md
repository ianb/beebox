# Speech progress indicators

Each spoken chunk uses its existing left border as a compact progress
indicator. The states differ by border style as well as semantic color, and a
screen-reader description prevents color from being the only signal.

```ts setup
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SpeechChunk } from "../../src/frontend/src/components/chat/SpeechChunk.js";

globalThis.React = React;

function render(state) {
  return renderToStaticMarkup(
    React.createElement(SpeechChunk, { state }, "Spoken words"),
  );
}
```

## Waiting for generated audio

```ts
const waiting = render("waiting");
waiting.includes('data-speech-state="waiting"')
=> true

waiting.includes("border-dashed")
=> true

waiting.includes("Speech audio is being prepared.")
=> true
```

## Playing audio

```ts
const playing = render("playing");
playing.includes('data-speech-state="playing"')
=> true

playing.includes("border-primary")
=> true

playing.includes("Speech audio is playing.")
=> true
```

## Sticky failure

```ts
const failed = render("failed");
failed.includes('data-speech-state="failed"')
=> true

failed.includes("border-double")
=> true

failed.includes("Speech audio failed.")
=> true
```
