# Speech Keyword Detection

`detectKeyword()` recognizes voice control commands in Whisper transcripts — things like "send message", "cancel", "microphone off". When a keyword is found, it's replaced with an XML tag in the transcript.

```ts setup
import { detectKeyword } from "../src/frontend/src/lib/speech-keywords.js";
```

## Send commands

Several phrases trigger sending:

```
detectKeyword("send message")?.action
=> send

detectKeyword("deliver the message")?.action
=> send

detectKeyword("finished")?.action
=> send

detectKeyword("send now")?.action
=> send
```

The matched phrase is replaced with a tag in the processed transcript:

```
detectKeyword("OK send message")?.processedTranscript
=> OK <send-message phrase="send message" />

detectKeyword("I'm finished")?.processedTranscript
=> I'm <send-message phrase="finished" />
```

## Cancel commands

```
detectKeyword("cancel message")?.action
=> cancel

detectKeyword("abort the message")?.action
=> cancel

detectKeyword("nevermind")
=> null
```

"Nevermind" alone doesn't match — it needs "message" or "microphone" after it:

```
detectKeyword("nevermind the message")?.action
=> cancel
```

## Mic off commands

```
detectKeyword("microphone off")?.action
=> micOff

detectKeyword("turn off the mic")?.action
=> micOff

detectKeyword("stop listening")?.action
=> micOff
```

## Erase commands

```
detectKeyword("erase the message")?.action
=> erase

detectKeyword("clear my message")?.action
=> erase

detectKeyword("start over")?.action
=> erase
```

## No match

Regular speech returns null:

```
detectKeyword("hello world")
=> null

detectKeyword("the weather is nice")
=> null
```
