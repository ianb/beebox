# Speech Keyword Detection

`detectKeyword()` recognizes voice control commands in Whisper transcripts — things like "send message", "cancel", "microphone off". When a keyword is found, it's replaced with an XML tag in the transcript.

```ts setup
import { detectKeyword, appendSendKeywordTag, sendKeywordIn } from "../../../src/lib/audio/speech-keywords.js";
```

## Send commands

Several phrases trigger sending:

```ts
detectKeyword("send message")?.action
=> send

detectKeyword("sent message")?.action
=> send

detectKeyword("said message")?.action
=> send

detectKeyword("same message")?.action
=> send

detectKeyword("deliver the message")?.action
=> send

detectKeyword("message finished")?.action
=> send

detectKeyword("send now")?.action
=> send

detectKeyword("it's a message")?.action
=> send
```

Bare "finished" does NOT trigger send — too easy to hit in normal speech. It needs "message" adjacent:

```ts
detectKeyword("finished")
=> null

detectKeyword("I'm finished")
=> null
```

The matched phrase is replaced with a tag in the processed transcript:

```ts
detectKeyword("OK send message")?.processedTranscript
=> OK <send-message phrase="send message" />
```

## Send and close

"Over and out" sends the message like a plain send, but signals the mic
should stay closed afterward (the "I'm done, take it from here" sign-off). It
gets its own action and tag. The older "send and close" family still works:

```ts
detectKeyword("over and out")?.action
=> sendClose

detectKeyword("send and close")?.action
=> sendClose

detectKeyword("send and close message")?.action
=> sendClose

detectKeyword("send and finished")?.action
=> sendClose

detectKeyword("send and stop")?.action
=> sendClose

detectKeyword("send and close the mic")?.action
=> sendClose

detectKeyword("set a closed message")?.action
=> sendClose

detectKeyword("OK send and close")?.processedTranscript
=> OK <send-close-message phrase="send and close" />
```

Precedence matters: "send and finish the message" satisfies the plain-send
pattern too (`finish … message`), and "send and stop the mic" / "send and
close the mic" satisfy the mic-off pattern (`stop the mic`, `close the mic`)
— but the close variant is checked first and wins all three, so none
degrades to a plain send or a bare mute:

```ts
detectKeyword("send and finish the message")?.action
=> sendClose

detectKeyword("send and stop the mic")?.action
=> sendClose

detectKeyword("send and close the mic")?.action
=> sendClose
```

## Send checkpoint

"Send checkpoint" is a plain send on the client (the mic re-arms), with its
own tag so the agent knows the user is still talking:

```ts
detectKeyword("send checkpoint")?.action
=> sendCheckpoint

detectKeyword("send a checkpoint")?.action
=> sendCheckpoint

detectKeyword("send checkpoint message")?.processedTranscript
=> <send-checkpoint-message phrase="send checkpoint message" />

detectKeyword("commit checkpoint")?.action
=> sendCheckpoint

detectKeyword("first part of the idea add checkpoint")?.processedTranscript
=> first part of the idea <send-checkpoint-message phrase="add checkpoint" />
```

Talking about checkpoints does not fire it: the commit/add verbs take no
article, and "checkpoint" alone is not a command:

```ts
detectKeyword("we should add a checkpoint before the deploy")
=> null

detectKeyword("the checkpoint failed again")
=> null
```

## Clean up and send

Both deliberate phrasings request an HQ transcription pass before the normal
send. They use the ordinary send tag because HQ is client-side preparation,
not a distinct command for the agent:

```ts
detectKeyword("clean up and send")?.action
=> sendHq

detectKeyword("clean up and send")?.processedTranscript
=> <send-message phrase="clean up and send" />

detectKeyword("OK send and clean up")?.action
=> sendHq

detectKeyword("OK send and clean up")?.processedTranscript
=> OK <send-message phrase="send and clean up" />
```

## Cancel commands

```ts
detectKeyword("cancel message")?.action
=> cancel

detectKeyword("abort the message")?.action
=> cancel

detectKeyword("nevermind")
=> null
```

"Nevermind" alone doesn't match — it needs "message" or "microphone" after it:

```ts
detectKeyword("nevermind the message")?.action
=> cancel
```

## Mic off commands

```ts
detectKeyword("microphone off")?.action
=> micOff

detectKeyword("turn off the mic")?.action
=> micOff

detectKeyword("stop listening")?.action
=> micOff

detectKeyword("close the mic")?.action
=> micOff

detectKeyword("mute the microphone")?.action
=> micOff

detectKeyword("pause listening")?.action
=> micOff
```

## Erase commands

```ts
detectKeyword("erase the message")?.action
=> erase

detectKeyword("clear my message")?.action
=> erase

detectKeyword("start over")?.action
=> erase
```

## No match

Regular speech returns null:

```ts
detectKeyword("hello world")
=> null

detectKeyword("the weather is nice")
=> null
```

## Re-injecting a send keyword the HQ pass dropped

Narration mode replaces the realtime transcript with a high-quality pass, and that pass can normalize a trailing trigger phrase away ("…send message" becomes clean prose). The realtime pass already heard the keyword — that's what fired the send — so when the HQ text comes back without one, the tag is appended rather than lost:

```ts
detectKeyword("Buy milk tomorrow.")
=> null

appendSendKeywordTag("Buy milk tomorrow.", { action: "send", matchedPhrase: "send message" })
=> Buy milk tomorrow. <send-message phrase="send message" />
```

The close variant re-injects its own tag, so a dropped "send and close" stays a
close sign-off in the persisted record:

```ts
appendSendKeywordTag("Buy milk tomorrow.", { action: "sendClose", matchedPhrase: "send and close" })
=> Buy milk tomorrow. <send-close-message phrase="send and close" />
```

A checkpoint re-injects its tag too, and the tag reads back as the same
variant, so an HQ pass restored after a reload keeps it:

```ts
const checkpointed = appendSendKeywordTag("Part one.", { action: "sendCheckpoint", matchedPhrase: "send checkpoint" })
checkpointed
=> Part one. <send-checkpoint-message phrase="send checkpoint" />

sendKeywordIn(checkpointed)
=> { action: "sendCheckpoint", matchedPhrase: "send checkpoint" }
```

Phrases with characters meaningful in XML are escaped, matching the tag form `detectKeyword` itself produces:

```ts
appendSendKeywordTag("Ping R&D.", { action: "send", matchedPhrase: 'send "the" message' })
=> Ping R&D. <send-message phrase="send &quot;the&quot; message" />
```
