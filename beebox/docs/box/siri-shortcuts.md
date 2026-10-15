---
title: Use Bee Box with Siri, voice notes, and sharing
read-when: The user asks how to capture thoughts or voice notes with Siri, Shortcuts, the Action Button, or the iOS share sheet.
---
# Use Bee Box with Siri, voice notes, and sharing

Pair a box in the iOS app. On the box screen, choose **Capture default**.
Browsing another box does not change that destination. With one paired box,
Bee Box can initialize the default; with several, choose one explicitly.
An optional Box parameter in a Shortcut pins its destination. Sharing shows
the destination and lets you override it for that share.

## A short thought through Siri

Say **“Save a thought in Bee Box”** or **“Add a thought to Bee Box”**.
Siri asks what you want to save; then speak your words. The initial phrase
does not promise to accept a free-form thought in the same utterance.

After persistence, Siri says **“Saved on your phone for <box>.”** That means
local acceptance, not confirmed server delivery or completed work. Transfers
can continue in the background. Open **Capture** on the box screen to inspect
the saved item, pending transfer, conversation choice, or failure. Siri does
not read the box's reply aloud or promise a second spoken update.

A box marked as requiring device unlock is **unavailable through Siri and
App Intent actions even while the phone is unlocked**. Unlocking it in the
app does not change that policy. Use an unprotected capture default or an
explicit authenticated foreground/share flow.

To supply text from another action, connect **Dictate Text**, **Ask for Input**,
or another text action to Bee Box's **Add a Thought to Bee Box** action.
Name the resulting Shortcut and invoke that name through Siri as an alternate
entry point. Dictate Text produces text; it does not preserve an audio note.

## A voice note

Say **“Start a voice note in Bee Box”**. The app opens into the voice-note
experience and starts after microphone permission. Finish with
**“Stop and save my voice note in Bee Box”**, or **Stop and Save** in the app
or Live Activity. **Record a voice note** on the box screen uses the capture
default; a recovered recording keeps its original box.

An Action Button can run Start Voice Note through Shortcuts. On iOS 18 and
later, Bee Box's **Voice Note** control is available for Control Center,
Lock Screen, and supported Action Buttons. It starts a recording or stops
and saves an active recording. An interrupted draft opens for Save or Discard.
Stopping a protected recording from its Live Activity/control opens the app's
unlock flow; Siri still refuses that box. Recording requires the relevant permissions and
may require unlocking the phone. iOS 18+ recording requires Live Activities;
iOS 17 uses the foreground voice screen.

Audio is preserved independently of transcription. An unavailable transcript
never means an empty voice note. Recordings stop and save at ten minutes or
the supported byte limit. An interrupted recording can recover completed
segments; sudden termination may lose its unfinished final segment, at most
ten seconds. The app shows Interrupted instead of claiming complete audio.

## Share material and say what to do with it

Share one image (under 20 MiB), web link, or text clipping to Bee Box. Check the shown box,
and add optional words in **What should the box know or do?** Use keyboard
dictation for spoken words if available. **Save to box** keeps material and
words together. With no words, it saves the material without inventing a task.
A saved URL preserves the URL; it does not claim the page was downloaded.

For URL/text, **Other destinations** preserves the existing direct-chat and
landmark-save choices. Those choices do not accept an image or accompanying
words; use Save to box for that combination. Protected shares use explicit
device-owner authentication.

Bee Box's general **Save to Box** Shortcuts action accepts one URL, image,
or text clipping plus optional Instructions and Box. Its Text parameter is
material; put words addressed to the box in Instructions. Use Add a Thought
for a plain human thought that should enter box-wide chat routing.

## Later context and recovery

Open a specific saved item under Capture and choose **Add context**. Its box
and original identity remain fixed even if you browse elsewhere or save a
newer screenshot. Words entered offline are saved on the phone and wait for
the original capture's receipt. Refresh status or retry when the box is reachable.

Offline or failed captures stay visible. Removing a target does not redirect
pending material. **Captures from removed boxes** exposes retained phone copies
for inspection/export, with their original unlock gate. Exporting does not send
or delete the original. A removed-box interrupted recording offers Export audio
or authenticated Discard; it cannot save to another box implicitly. Automatic retries are bounded; an uncertain expired delivery
needs reconciliation rather than a new message ID. Force quitting iOS can cancel
background transfers; reopen Bee Box to recover. Deleting a saved source does
not undo messages or work already sent to chat. Offline deletion records
**Discard requested — waiting for box confirmation**, stops future phone uploads,
and keeps the source until the box confirms deletion. An already delivered
message cannot be recalled by this action.
