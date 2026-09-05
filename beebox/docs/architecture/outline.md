# Architecture Docs Outline

These docs tell the story of how the system works through the Lund-Vega family. Each section uses their lives as running examples, with technical architecture emerging from the stories. Illustrations throughout (primitive crayon style, per `image-gen.yaml`).

Supporting docs (not user-facing): `spirit.md` (values compass), `family.md` (character reference), `image-gen.yaml` (illustration config).

---

## 1. What Is This Thing?

**Opening scene:** Saturday morning, the Lund-Vega household. The family has a Telegram group — Diana, James, Rosa, and the box. (Mateo was added but muted it.) The box posted overnight: it sorted out a scheduling conflict for next week and has a question about the Costco list. Rosa replied in Spanish. James thumbs-up'd something at 2am between shifts. Diana's reading the thread now with coffee.

The group conversation is the primary shared surface — the box participates in the family conversation rather than being a separate thing everyone talks to privately. That group exists in both Telegram and the web chat. But there are other surfaces too: capture pages for voice memos and photos, and pages the box creates on its own.

What the reader should understand:
- A box is a shared family system — both a conversation space and a shared repository of the family's stuff
- The group chat (Telegram and web) is the main shared space — the box is a participant, not a hub
- Other surfaces exist: capture pages (voice, photo, text), generated pages and views
- Different people engage differently — Diana checks everything, Rosa replies in Spanish, Mateo ignores it, Sofia asks it questions directly sometimes
- The box also reaches out on its own: notifications, assembled pages, custom views
- It runs in the background, doing things on its own schedule

Use small vignettes here to introduce each family member and show different features at the same time. The introductions *are* the feature tour. (Full character details in `family.md`.)

**Illustration:** The Saturday morning kitchen scene (exists). Maybe a simple diagram of the box's surfaces — group chat at the center, capture and generated pages as additional surfaces.

---

## 2. Cards and Memory

**Story/vignette:** Something small and concrete — someone interacting with the box and we see what the box is holding. Could be Diana looking at the week ahead and we see the cards behind the view: James's shift schedule, Sofia's swim meets, Rosa's medication reminders. Or Rosa recording a story and we follow it from voice to card.

**Architecture — cards:**
- Different card types hold different kinds of data (schedules, memos, contacts, stories, etc.)
- Schemas keep the agents honest — they can't just make up whatever structure they want, and things stay consistent across processing runs
- But schemas also have escape valves: fields that can hold ad hoc information so nothing gets dropped. If the box doesn't know where something goes, there's always a place to put it
- Schemas can change over time, and some are extensible in simple ways — the system evolves
- XML is the format but that's an implementation detail; what matters is typed, validated, structured data

**Architecture — preserving originals:**
- When the box processes messy input (a voice memo, a photo of a schedule), it should keep the original alongside the structured version. The structured card is the box's interpretation; the original is the source of truth
- We can do this somewhat now with attachments/sidecars, but it's partly aspirational — we need to think more about how to keep original words available when they exist
- Attachments need a more general pattern: currently a card can have a sidecar file, but if there are multiple attachments we'd need a directory. There should be a clear convention for this

**Architecture — the filesystem and Git:**
- The filesystem is the *canonical* state — not a cache of some database, not a projection. The files are the thing
- Git is the *canonical* history — every change committed, every commit traceable to what triggered it
- This means you can look at the box's contents with normal tools, see what changed and when and why

This section should make cards feel concrete and tangible. Show what a card actually looks like through a family example, then pull back to explain the architectural choices.

**Illustration:** Maybe Rosa and Sofia at the table (exists) — the story being told becomes a card being created.

---

## 3. The Wakeup Cycle and Agents

This section needs multiple small vignettes, going back and forth between stories and architecture. The wakeup cycle happens constantly, not just overnight.

**Vignette: Forwarded email.** Diana has a Gmail filter that forwards Sofia's swim schedule updates to the box. An email arrives with an updated PDF. The box wakes up, sees the forwarded email, processes the PDF, updates the schedule card, notices a conflict with James's shifts, posts a question to the group chat. Forwarded email is a primary intake pattern — it fits naturally with the group model, you just set up filters and things flow in.

**Vignette: Something from the group chat.** James sends a photo of his posted work schedule to the Telegram group. The box sees it, parses it, creates/updates the shift cards. Maybe it gets something wrong and asks for confirmation.

**Vignette: Adding a new connector.** Diana decides she wants the box to track Sofia's swim team announcements that come via email. She sets up a new forwarding filter. What happens the first time a new kind of email arrives? The box has to figure out what it is and what to do with it.

**Architecture — the wakeup cycle:**
- The cycle: sync connectors → process inbox → execute commands → archive
- It runs on a schedule, not just in response to user actions — the box does things on its own
- Connectors are how the outside world gets in: forwarded email, Telegram, calendar sync, browser-extension captures, etc.
- Each connector syncs its source into the box's filesystem as cards

**Architecture — agents:**
- Agents (Claude Code) do the processing — reading cards, making decisions, creating new cards, committing changes
- Agents read the same history and context a person would — introspection isn't bolted on, it's how the system thinks
- Every action has a source, every decision has a reason, captured in commits and logs

Show at least one example end to end: email arrives → connector syncs → inbox card created → agent processes → new cards/updates → committed → question posted to group.

**Illustration:** Diana in the car at 5:45am (exists). Maybe a Mermaid diagram of the wakeup flow.

---

## 4. Questions, Feedback, and Adaptation

**This is the design exploration section.** Use the stories to figure out what adaptation should look like, not just describe what exists.

**Vignette: Clarification questions.** The box parsed James's schedule but the photo was blurry — "I think he works Thursday evening, can you confirm?" Clarification is the biggest use case for questions. The box is honest about uncertainty and asks rather than guessing. Sometimes Diana answers. Sometimes she doesn't. Sometimes the question goes moot because James told her directly. Questions have a lifecycle.

**Vignette: Filtering what you see.** Diana says in the group chat: "I don't need to see every email from the swim team, just when the schedule changes or there's a meet cancellation." That's explicit feedback about how she wants information filtered.

**Vignette: Requesting an automation.** James says: "Can you send out my shifts for the week on Sunday night? And tell people if any of them change during the week." Now the box needs to create a new recurring task — a procedure that runs weekly and also watches for changes.

**Vignette: Tone and presentation.** Someone tells the box to change how it communicates — less formal, more concise, different grouping. This feeds into guidelines (persistent rules about how the box behaves) and potentially into procedures (how it structures recurring outputs). Figuring out the right mechanism for storing and applying these preferences is an open question.

What the reader should understand:
- Questions are primarily for clarification — the box asks when it's uncertain rather than guessing
- Every input surface is open-ended — you can say whatever you're thinking, not just commands
- Questions have a lifecycle: asked, answered, moot, expired
- Adaptation is mostly explicit: people tell the box what they want, how they want it, what's useful and what isn't
- The box should be getting better at presenting information — figuring out the right level of detail, the right format, the right grouping for each person
- The box should be honest about what it knows and doesn't know

**Open design questions to explore here:**
- How does the box track preferences about information presentation?
- When someone says "I don't care about X" — how is that stored, how does it affect future behavior?
- What's the UI for seeing/changing how the box has been configured through feedback?
- How does the box get better at presentation over time — what does that feedback loop look like?

**Illustration:** Something showing the feedback loop — maybe a group chat where someone is telling the box what they want.

---

## 5. How It Got Here / How It Changes

**Story: Flashback.** Diana set up the box a few months ago. Set up email forwarding filters — swim team emails, school announcements, pharmacy notifications. Added Rosa to the Telegram group. The box started figuring out what each kind of email meant and what to do with it.

**Story: Something new.** James starts sending photos of his posted work schedule to the group chat instead of just to Diana. The box sees a new kind of input, figures out what it is, starts parsing it. The first time it gets the format wrong. It asks. It learns.

**Story: Asking why — schedule conflict.** The box tells Diana she needs to drive Sofia to swim on Tuesday. She asks "why me?" The box traces it: James's schedule changed (here's the photo he sent), he's on evenings this week (here's the shift card), so he can't do the 5:30am drop-off. Diana's the fallback. Every step has a source you can follow back.

**Story: Asking why — something unexpected.** The box added something to the grocery list that nobody recognizes. "Why is tahini on here?" The box can show: Sofia's recipe from last week called for it, it wasn't on the list yet, so it got added. The chain of reasoning is visible — not just the current state but how it got there. (This is aspirational — we don't currently keep enough reference information to trace back like this, especially when the source was a chat message. But we want to. How to maintain provenance links from actions back to the inputs that caused them is an open design question.)

What the reader should understand:
- Setup isn't a one-time event — the box is always being taught
- Email forwarding is the primary intake pattern — fits naturally with the group model
- Configuration is interleaved with the box doing things (you connect something, the box immediately acts on it)
- The box evolves: new connectors, new card types, new procedures emerge from use
- Teaching the box is part of using it — answering questions, correcting mistakes, adding new inputs
- You can ask "why" and get a traceable answer — sources, references, the chain of decisions

**Illustration:** Maybe James photographing the posted schedule, or Diana at a laptop doing initial setup.

---

## 6. Cooking and Inventory (A Case Study)

A case study that shows several features working together. Interesting because it involves partial knowledge, real-time interaction, and shared resources.

**Vignette: Inventory.** Diana walks through the kitchen with the capture page open, narrating what's in the pantry and fridge. "Rice, black beans, two cans of coconut milk, that bag of dried chiles Rosa brought back..." The box builds up an inventory from this — not a precise count, but a baseline of what the household typically has on hand. More than half the food is just stuff they always keep around: olive oil, flour, spices, rice. Over time the box learns the baseline and can say "I think you have cumin" even if nobody's confirmed it recently. This is a great example of partial knowledge — the box knows you *had* something as of a certain date according to someone, but not necessarily right now. That's still useful information, and the box should be able to work with it honestly: "you probably have this, but it's been a while since anyone checked."

**Vignette: Planning and shopping.** Rosa mentions in the group she's making pozole this weekend and needs specific chiles. The box checks: do we have what she needs? Some things yes (from the baseline), some things no, some things uncertain. It adds what's needed to the grocery list, grouped by store — Aldi for basics, La Colonia for the specific chiles. Diana says "we're going to Costco Saturday, add it to that list." The grocery list is a living, shared thing — multiple people add to it, the box groups by store, reminds before trips, tracks what's recurring.

**Vignette: Cooking with the box.** Sofia gives the box a recipe and starts cooking. The box walks her through the steps — she tells it what she's doing, it tells her what's next. "The onions need to soften for about five minutes, I'll check back with you." It sets timers and calls back to her when they're done. She asks "can I use regular milk instead of buttermilk?" and the box suggests a substitution. This is real-time, back-and-forth interaction with a custom presentation — not the same interface as the group chat, but a cooking page with steps, timers, and a place to ask questions.

**Vignette: After cooking — follow-up.** After dinner, the box checks in: "How was the pozole? Worth making again?" Rosa says "good but needed more guajillo next time." Sofia says she liked it. Diana says they used up the hominy. Thirty seconds of feedback, and now the box knows something: the recipe is a keeper with a modification, the inventory changed, and it has a little more context about what this family likes to eat. This ties back to the question/feedback system — the box asking at the right moment, keeping the answers, building up knowledge over time.

**Architecture this illustrates:**
- Partial knowledge and confidence — the box working with uncertain, time-stamped information rather than requiring perfect data
- Inventory as a baseline that degrades gracefully over time
- Custom pages/views generated from data (the cooking page)
- Timers and callbacks — the box reaching out in real time
- The grocery list as a shared, multi-source card that evolves through group input
- Custom prompting — the cooking interaction has a different feel than scheduling or the group chat
- Capture as inventory tool — voice narration becoming structured data

**Illustration:** Sofia in the kitchen with her phone propped up, cooking.

---

## 7. What the Box Shows You

This section is a good place for playfulness — the box creating things that are delightful, not just functional.

**Story:** Diana opens the web interface. What does she see? Not a dashboard designed by a product team — a page the box assembled based on what it thinks matters right now. James's schedule changed. Sofia has a meet this weekend. Rosa's medication refill is due. There's a question about the Costco list.

**Story: James's build journal.** James has been sending photos and voice notes about the canoe build to the box. The box turns this into a published webpage — a real build journal with his photos, what he said about what he's doing, dates, progress. Something he'd never have maintained himself, but now it exists and he can share it. The box knows how to make web pages; the content was already there. (We don't have webpage publishing per se yet, but agents know how to generate HTML, so the setup is close.)

**Story: Sofia and Rosa's stories.** Rosa's been recording family stories. Sofia decides to do something with them — maybe a word cloud of her grandmother's stories, or an illustrated timeline of the family, or just browsing them organized by topic and person. Sofia exploring her grandmother's memories through the system, doing something creative with material that's already in the box. That's playfulness that's real — it comes from the family, not from the AI being clever.

**Story: Sofia's swim times.** Sofia wants to see her swim times trending over the season. The box creates a page for her — a chart, her best times, how she's improving. Built from the meet results that have been flowing in through email.

**Story: Mateo.** Mateo uses the box less than everyone else, but he's not absent. He asks it things sometimes — music production questions, or something for school. He might use the cooking feature when he's home alone. The interesting thing about Mateo is that he uses it on his own terms, for his own stuff, not for the family logistics that Diana cares about. The box works for him without requiring him to care about how it works.

What the reader should understand:
- The web interface is a surface, not *the* product
- The box can create its own pages and views — it's an active presenter, not just a data store
- Published pages (like James's build journal) are a natural output — the box assembles content that already exists into something shareable
- Playfulness comes from the family's own material and creativity, not from the AI performing
- The box works even for people who don't actively use it — Mateo's stuff can be in there without Mateo having to maintain it
- Notifications go out through multiple channels (web, Telegram, etc.)
- Custom views are one-step aspirational: the pieces are there, the assembly is the work

**Illustration:** A phone screen showing Diana's morning view? Or James's build journal page. Or Sofia browsing Rosa's stories.

---

## 8. Composability and Possibility

This section should walk through a real example of someone having an idea and actually setting it up. Not a simple feature that would already be built in, but something specific enough that it shows how the primitives combine.

**Story: Mateo builds a game master interface.** Mateo's running a D&D campaign with his friends. He starts using the box to build his own GM tool — not just storing notes, but creating something he uses *during* sessions. He feeds it his world-building: NPCs with backstories and motivations, locations, plot threads, faction relationships. He records session recaps and the box pulls out what happened, updates character states, tracks which plot threads advanced.

But the real thing is the interface he builds for himself. During a session, Mateo has a page open that shows him: the NPCs in the current location, their motivations, what the players don't know yet, relevant plot threads. When a player does something unexpected, he can ask the box "what would the guild leader do about this?" and get an answer grounded in the world he's built, not generic fantasy. He sets up a timer for in-game events ("the reinforcements arrive in 20 minutes"). After the session, the box generates a recap page his players can read.

This is Mateo building something genuinely his own — a custom tool for a specific creative purpose, assembled from the same primitives that track Rosa's medications and Sofia's swim schedule.

**Walk through how he actually does it.** This section should be concrete and specific:
- What does Mateo actually do to set this up? Does he describe what he wants in the chat? Create a procedure? Just start dumping notes in and shape it from there?
- What primitives is he combining? Cards for NPCs and locations, custom pages for the GM view, capture for session recordings, timers for in-game events
- What does the first version look like? How does he iterate — "show me their motivations too," "add a section for secrets"
- How does it evolve over multiple sessions?

The point is to show the reader the actual process of going from "I have an idea" to "it works" — not magically, but through visible, understandable steps. And it's Mateo, the one who engages least with the family logistics, who ends up pushing the system the furthest in a new direction.

What the reader should understand:
- The system is built from primitives: cards, procedures, connectors, agents, the filesystem, Git
- Those primitives are legible to both people and agents
- New capabilities emerge from combining existing pieces, not from feature requests
- The feeling should be "obviously possible" — you see the building blocks and the combinations suggest themselves
- Setting something up involves describing what you want, trying it, correcting it — a conversation with the box, not a configuration wizard
- We're still figuring out what the right primitives are — that's part of the work

**Illustration:** Something about building blocks? Or just end with the kitchen scene again — the family living their life, the box holding it all together.
