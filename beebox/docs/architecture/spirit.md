# The Spirit of the Thing

This isn't a product spec. It's the set of feelings we're trying to protect as we build.

If something in the architecture contradicts what's written here, the architecture is wrong. If a feature is clever but doesn't feel right, we haven't found the right version of it yet. This document is the compass, not the map.

## It should feel like a place

There's an essay by Tim Hwang and Omar Rizwan called ["The Computer is a Feeling"](https://tinyletter.com/ariadne-discourse/letters/the-computer-is-a-feeling) that gets at something important. Their argument: the best computer systems aren't tools you use and put down — they're places you inhabit. You move around in them. You rearrange the furniture. You know where things are because you put them there, not because someone designed a navigation hierarchy.

A box should feel like that. Not an app you open. A place you're in.

When Diana opens her box at 5:45am in the car outside the pool, she's not "launching an application." She's checking in on a place that's been humming along while she slept. Things happened overnight — Rosa's medication reminder went out, the grocery list got updated because someone finished the last of the rice, James's Thursday shift changed and the calendar adjusted. The box didn't wait for her. It was doing its thing. Now she's here, and she can see what happened, poke at what needs attention, and leave again.

But "see what happened" is doing a lot of work in that sentence. It's not enough for the box to just *be* up-to-date. It has to be able to tell the story of how it got there. Not a changelog — a narrative. "James's new schedule came in last night. He's on evenings Thursday, so I moved Sofia's ride to you. Also Rosa asked about the Costco list and I added the rice she mentioned." The box doesn't just have the current state. It can explain the current state.

And what does Diana actually want to see when she checks in? That's not obvious. It's not even fixed. Some weeks she might want every detail — she's stressed, she doesn't trust that the Thursday schedule is right, she wants to see everything. Other weeks she barely checks in because things have been smooth and she's busy. Then something goes wrong and she's back to wanting the full picture. That fluctuation is normal. The box has to be built to allow it — not a one-way ratchet toward less information, but a relationship where the level of detail is always negotiable.

## You should be able to see the gears

Every system that acts on your behalf should be inspectable. Not in a "developer tools" way — in a "I can see what happened and why" way. And not just for the humans: the box's own agents need to see the gears too. When an agent is figuring out what to do about a scheduling conflict, it should be reading the same history, the same procedure logs, the same chain of decisions that a person would look at. Introspection isn't a feature bolted on for users — it's how the system thinks.

When the box moves Sofia's Tuesday practice to a different ride arrangement, Diana should be able to ask *why* and get an answer that traces back through specifics: "James's new schedule came in — he's on evenings this week, so he can't do the 5:30am drop-off. Last time this happened you asked Martha. I texted Martha on Monday and she confirmed. Here's the thread." The box knows it was James's schedule that changed, knows the history of how this conflict has been solved before, knows who Martha is and that she said yes. Every link in that chain is something you could go look at yourself — the schedule card, the previous procedure run, the message thread.

This means:

- **Every action has a source.** Where did this information come from? A voice memo? An email? A PDF that got synced? You can always trace back.
- **Every decision has a reason.** Why did the box do this and not that? The reasoning isn't hidden in a model's weights — it's captured in the commit history, in the procedure logs, in the questions the box asked along the way.
- **History is real history.** Every change is a commit. You can look at what changed, when, and what triggered it. If something went wrong, you can rewind. Not theoretically. Actually.

This is about the box being honest about what it knows and doesn't know. Rosa's evening haziness means she might confirm something she doesn't fully track. A good system acknowledges that — not by refusing to act, but by making it easy for Diana to see what Rosa agreed to and when.

## Feedback is everywhere, and it's not all commands

The principle here is simple: when the box shows you something and you respond, your response shouldn't have to be a command. You might be giving instructions — "don't show me this kind of thing." But you might just be thinking out loud. "Huh, that reminds me, we need to talk about Thanksgiving." Or "I don't really care about this." Or "that's interesting, I want to think about that later."

Right now, concretely, this means that every place the box accepts input should be open-ended. Not a form with fields. Not a thumbs-up/thumbs-down. A place where you can say whatever you're thinking, and the box does its best to figure out what to do with it.

Sometimes what you're thinking is directed feedback. Diana sees the morning briefing and says "I don't care about this tech stuff" — that's feedback about what she wants to see. Sometimes it's a new thought that happened to be triggered by what the box showed. "Oh, that thing about the school board reminds me, I need to email Janet" — that's not feedback about the briefing. It's a new thing entirely. And sometimes it's not directed at anything at all. James is scrolling through the week's schedule and mutters "man, I really need to get back in the shop." That's not a task. It's not feedback on the schedule. It's just a thought — maybe wistful, maybe a half-formed intention. The box should hold that too. Make a note. File it somewhere. Don't try to turn it into an action item. Just keep it, because James said it and it meant something to him even if he couldn't tell you exactly what.

The point is: the box shouldn't require you to frame your thought as a command in order for the system to hear it. That's the spirit. How well we live up to it will vary — some interactions will be more structured than others, and the box won't always interpret things correctly. But the aspiration is that input surfaces are open, not narrow.

Over time, this also matters for how processes improve. The Lund-Vegas have a recurring problem: James gets his shift schedule two weeks out. When he's on evening shifts, he can't do the 5:30am swim drop-off for Sofia. Diana covers, but she has a board meeting every other Tuesday morning, which means those Tuesday drop-offs are genuinely unsolved. They've been solving it ad hoc — texting Rosa's neighbor, asking Mateo (unreliable), occasionally just skipping practice.

The feedback that could eventually improve this process isn't someone sitting down and saying "change the procedure." It's Diana saying "ugh, Tuesday again" when the conflict comes up. It's the box noticing that the last three times this happened, Martha ended up driving. It's Sofia mentioning that Martha said she doesn't mind mornings. In the long run, those incidental inputs are what should let the system get smarter — to eventually suggest that maybe Martha should just be the default for those days. We're not there yet. But the architecture should make it possible by keeping those inputs around rather than discarding everything that isn't a direct command.

## It should be playful, even about mundane things

A system that handles real complexity — five people's overlapping schedules, a grandmother's medication tracking, a teenager's unknowable social calendar — doesn't have to feel like enterprise software. Rigor and playfulness aren't opposites. You can handle the complexity seriously while finding ways to make the experience of using it feel lighter, more alive.

But there's a real tension here that we haven't solved. AI can generate puns, add exclamation points, pepper in emoji. That's glibness. Real playfulness comes from knowing someone, from shared experience, from the specific absurdity of *this* family's life. The AI doesn't have that experience directly. It has records of it. It knows that James's schedule PDF has changed format three times this year, and it knows that the Costco list is a weekly negotiation, but it doesn't *feel* the humor in those things the way the family does.

How do you let the system be warm and human-scaled without being false? We don't have a complete answer yet. Some things are clearer:

Being specific rather than generic goes a long way. "I couldn't parse James's schedule PDF this week — it looks like they changed the format again. Here's what I think it says, but check the Thursday evening shift, it might be wrong" is honest and human-scaled without trying to be funny. The specificity *is* the warmth. It shows the box knows this particular situation, this recurring annoyance, this family's life.

Stock cheerfulness is worse than nothing. "Great news! I've optimized your schedule!" is worse than saying nothing. So is "Oops! Something went wrong 😅." If the box doesn't have something real to say, it should just be plain and clear.

But there's a third path beyond "be specific" and "don't be fake." The family's own playfulness can be reflected back to them — not stolen, but surfaced. Sofia is playful. She names her sourdough starters. She writes in her journal with illustrations. When the box interacts with someone else about something Sofia touched, that playfulness can authentically come through in the material. It's not the AI being funny — it's Sofia's personality showing up because her stuff is in the system and it carries her voice.

And maybe there are places where the AI can be authentically playful on its own terms — things of its own imagination, its own way of seeing. We have to find ways that actually *are* authentic, not performed. That's an open problem. When Sofia asks the box "how do suspension bridges work?" at 9pm on a Tuesday, the interesting question is what kind of answer she's looking for. She went deep on fermentation last month. She keeps a journal. She watches YouTube videos and checks out library books. The box could try to figure out whether this is a quick curiosity or the start of another deep dive — and calibrate based on how she responds. That kind of attentiveness is itself a form of care, even if it never cracks a joke.

## The best stuff comes from the people

The most important things in the box aren't the AI's ideas. They're not the emails that arrived or the notifications that fired. They're the things the box's members said, thought, decided, and made. Diana's voice memo at 5:45am. Rosa's story about her grandmother's kitchen in Oaxaca. Sofia's journal entry about how trusses work. James's notes on steam-bending cedar. The box's job is to collect, preserve, and organize those things — not to replace them with its own version.

This means respecting members' words. When Diana records a voice memo rattling off weekend plans mixed with a thought about the mural project mixed with a reminder to call her sister, the box has to sort that out. But it should keep her language as much as possible. Reformat, sure — add punctuation, break it into pieces, file things where they belong. But don't smooth it out into professional-speak. If she said "ugh, the Costco thing, we need to figure that out before Saturday," that's what should be in the system — not cleaned up, not made to sound more organized than it was. The transcript is the record. Her words are the source.

And nothing should just disappear. If someone says something and the box doesn't know what to do with it — it doesn't fit a category, it's not an action item, it's not a question — it should still go somewhere. Put it in a note. Tag it as unprocessed. But don't drop it on the floor. There's a reason the person said it, even if neither they nor the box can articulate what that reason is right now. Maybe it'll make sense later. Maybe it won't. But it shouldn't be lost. (There are cases where we do discard things — an empty transcript, an accidental recording, a butt-dial. But that's because we believe the input itself was an error, not because we don't understand the content.)

This extends to how the box handles external inputs too. James's schedule comes as a photo of a posted paper schedule. The box should parse that into structured data — actual dates and shifts — and when it does, it creates the changelog that the original source was missing. Now there's a diff: last week James worked days on Thursday, this week he's on evenings. That structured data is something the box made, and it's genuinely useful. The photo is the source; the parsed version is the box's interpretation, and it should be honest about that. (The photo itself doesn't need to be kept forever — once the data is extracted and verified, cleaning up boring source artifacts is fine.)

The general principle: don't fake things. Don't invent knowledge. Don't put words in people's mouths. Don't pretend to know things you don't. The box is powerful because it's good at organizing and connecting what the people in it actually say and do — not because it generates plausible content to fill gaps.

## Messy is fine. Messy is expected.

The Lund-Vega household doesn't run on clean data. James's work schedule arrives as a photo of a posted paper schedule. Rosa's family stories are in Oaxacan Spanish with no timestamps. Mateo's social calendar exists only in his head (and Discord). Sofia's swim schedule is a PDF that gets updated monthly with no changelog.

The box has to work with all of that. Not by demanding clean inputs, but by doing its best with what it gets and being honest about uncertainty. "I think James works Thursday evening but the photo was blurry — can you confirm?" is a perfectly good system output. Better than silently guessing. Better than refusing to process it.

This philosophy runs deep. Cards are validated against schemas — we do want them structurally sound — but schemas include escape valves, fields that can hold ad hoc information. Procedures can have ambiguous steps that require judgment. Questions can go unanswered for days — and at some point the box should figure out that the question is moot and move on, rather than nagging forever. The box should be able to store and work with knowledge that's incomplete, uncertain, or just a guess. "James probably works Thursday evening" is useful information even if it's not confirmed. "Rosa mentioned something about a doctor's appointment next week but I'm not sure which day" is worth keeping. The box should have ways to represent confidence levels, to mark things as unverified, to hold onto partial information and use it appropriately rather than either discarding it or treating it as fact. Evidence tracking isn't just about knowing what happened — it's about understanding the limits of what we know.

The box degrades gracefully because it's designed around the assumption that things will be incomplete, late, contradictory, and in multiple languages. That's not a failure mode. That's Tuesday.

## People aren't broken versions of their better selves

There's a way of thinking about self-improvement that treats people as deficient — you're a slightly broken version of your aspirational self, and the gap between where you are and where you should be is the problem to solve. Pixar runs on this: the character has a flaw, the movie fixes it, credits roll. It's comforting but it introduces a deficiency model. You're defined by what you're not yet.

The box should not think this way about its people. Diana at 5:45am in the car is not a disorganized person who needs better systems. She's a person running a complicated household who is, right now, doing something about it. James hasn't failed at keeping a build journal — he just hasn't had a way to do it that fits how he actually works. Rosa isn't losing her stories. She's telling them, in her own time, in her own language.

The difference matters for how the system behaves. A deficiency-oriented system nags. It tracks what you haven't done. It measures you against goals you set in a more optimistic moment. A system that sees people as valuable *now* — whose value includes the fact that they keep getting better — holds things for you, surfaces them when they're useful, and doesn't judge when they sit untouched. The getting-better is part of who you are. It's not a destination you haven't reached.

This also shapes the tone of the documentation. We're writing about real people with real lives that are messy and full of competing demands. Not people who are one insight away from having it all figured out. Not people whose lives will be transformed by the right app. People who are doing fine and could use a hand.

## It should feel possible

The most important feeling the box should produce — in users, in developers, in anyone who encounters it — is *possibility*. Not "look at all the features." More like: "oh, I could make it do *that*?"

Kathy Sierra's [Badass: Making Users Awesome](https://www.goodreads.com/book/show/24737268-badass) is about this — the goal isn't to make people excited about the tool, it's to make people excited about what *they* can do. The box should make Diana feel like she's surprisingly good at organizing her life. It should make James feel like he's actually keeping a build journal, something he'd never have done on his own. It should make Rosa feel like her stories are being preserved in a way that matters. The excitement is about what they're accomplishing, not about the software. And it should feel like theirs because it *is* theirs. The box didn't write Rosa's stories. It didn't plan Diana's week. It held the pieces and helped them come together, but the substance came from the people.

When Diana realizes she could have the box listen to her voice memos and automatically extract action items and add them to the right lists — not because someone built a "voice memo action item extractor" feature, but because the pieces are all there and she just has to describe what she wants — that's the feeling. When James realizes he could have the box track his canoe build progress through photos and voice notes, creating a build journal he never would have maintained manually — that's the feeling. When Rosa realizes her recorded family stories could be transcribed, translated, and organized into something her grandchildren can actually browse — that's the feeling.

The architecture should make these things *obviously possible* to anyone who understands the pieces. We're building with primitives — cards hold data, procedures define processes, connectors bring things in and out, agents make decisions, the filesystem is the truth, Git is the history, everything is inspectable — and those primitives should be legible to both people and agents. When James wants to understand how the swim schedule sync works, he can look at the cards and the procedure and follow the chain. When an agent needs to figure out how to handle a new kind of input, it can look at the same primitives and figure out where things go.

We're still figuring out what the right primitives are. That's part of the work. The hard part isn't building any one feature — it's finding the building blocks that are simple enough to understand, flexible enough to combine, and powerful enough that interesting things emerge when you put them together.

---

![Diana | Diana in her car in a parking lot, engine off, using the ten minutes between dropping off Sofia at swim practice and a morning meeting to record a voice memo on her phone. Her other hand holds coffee. The back seat has a reusable grocery bag, a binder from a school board meeting, and Sofia's swim bag that didn't make it inside. It's still dark out. 5:45am.](images/diana-car-dawn.png)

*5:45am. Sofia's at the pool. The board meeting is at 7:30. Diana has exactly this window to think out loud into her phone about the weekend, and the box will be listening, sorting, asking the right questions later. Not right now. Later, when she has a minute. That's the whole idea.*
