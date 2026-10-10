---
title: Use Bee Box with Siri and Shortcuts
read-when: The user asks how to capture a thought with Siri or pass text to Bee Box from an Apple Shortcut.
---
# Use Bee Box with Siri and Shortcuts

Bee Box has a text-capture action for Siri and the Shortcuts app. After pairing
a box and selecting it in the Bee Box app, say **“Add a thought to Bee Box”**
or **“Save a thought in Bee Box”**, then provide the text to capture. The action
sends that text to the box currently selected in the app; it does not ask which
box to use. If the selected box requires device unlock, Siri cannot access it.
Open Bee Box and unlock that box before using Siri.

To pass text from another Shortcut action:

1. In the Shortcuts app, add Bee Box's **Add a Thought** action.
2. Connect the earlier action's text output to the thought input. For example,
   use **Dictate Text**, **Ask for Input**, **Get Clipboard**, or another action
   that produces text.
3. Run the Shortcut. The action captures text only; it does not accept images
   or audio recordings.

The App Shortcut can also be assigned to an Action Button where the device
supports that option. Siri, Shortcuts, and the Action Button invoke the same
capture action, and Bee Box cannot tell which surface started it.

Siri's result reports the capture state: it may confirm that the thought was
sent, explain that a destination needs to be chosen in Bee Box, or say delivery
could not be confirmed. It does not read the box's reply aloud. The reply is in
the chat chosen by quick chat and can be read the next time the person opens Bee
Box.
