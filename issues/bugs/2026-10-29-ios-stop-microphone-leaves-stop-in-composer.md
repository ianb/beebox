---
title: "iOS: saying \"stop microphone\" turns the mic off but leaves \"stop\" in the composer"
workstream: unattached
area: ios-app
labels: [ios, voice, dictation, keywords]
filed-by: agent
discovered-by: Ian
discovered-in: "main session — boxholder report from the iOS app, 2026-10-29"
---

On iOS, saying "stop microphone" turns the microphone off, and the word
"Stop" stays in the text box.

Likely cause, from reading the code (not reproduced): mic-off is one of the
actions that discards the keyword substitution
(`SpeechKeywordAction.commitsKeywordSubstitution`,
`ios-app/BeeBox/Services/SpeechKeywords.swift`). `discardKeywordSubstitution`
(`ios-app/BeeBox/Services/SpeechDictation.swift:383`) keeps the composer's
"pre-keyword" text, which is whatever the recognizer last published. The
recognizer publishes partial results, so it shows "Stop" before
"microphone" arrives. "Stop" alone matches no keyword, so it is published as
text; the next partial, "Stop microphone", matches mic-off, and discarding
keeps the published "Stop". The other discarding actions (cancel, erase)
clear the draft afterwards, which hides the same leak. "Stop listening",
"close the mic", and "mute the mic" have the same shape.

Direction: on a discarding action, set the composer to the transcript with
the matched words removed (the text before the match in the held
substitution), not to the last published text. A test through
`ingestRecognizedSpeechForTesting` can feed "Stop" then "Stop microphone"
and check the composer text is empty.
