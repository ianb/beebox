---
description: "Documentation for Bee Box: a personal assistant built from a coding agent and a folder of files you own, its design choices, and the ways you use it."
---
> A few ideas run through Bee Box. An assistant should accumulate, and you
> should be able to see not just what it knows but how that came to be, in a
> history you can read. For the same reason the system is open source, so
> that it can view and understand its own mechanics. Data is typed, a recipe
> as a recipe, a person as a person, and it always has room for natural
> language alongside the fields, so nothing is lost for not fitting a type
> yet, and a fact can carry where it came from and whose words it is. Putting
> things in should be easy and expressive: voice, camera, a gesture on a
> phone, a clipped page, a chat, each suited to a different kind of thing you
> might want to keep. And you should be able to review and refer back to what
> is there, with the assistant alongside you.
>
> ## What it is for
>
> It works well as a place to put things you do not yet know how you want
> to keep. You start by putting stuff in: a shoebox of receipts, a pile of
> papers, the contents of a shelf, whatever is in your head after a walk.
> It becomes records you can ask about, in effect a database you never had
> to design. As you use it, the organization that fits what you actually put
> in emerges, and the box takes that shape.
>
> It also synthesizes: notes and thoughts talked through over weeks come back
> as something you can read, with the todos and open questions pulled out.
> And it keeps literal track of what you said versus what it thought: your
> words are kept as your words, and the assistant's inferences are marked as
> its own, so you can always tell the two apart.
> Email is handled from within the box, with replies drafted for you. Recipes
> scale; people and places are recognized; a project gets a working memory;
> something you are learning gets a course built for it. And what you correct
> stays corrected. Each of these has a page under "uses" below, including what
> is still rough.
>
> Alongside those ideas, a few choices. The assistant is a coding agent,
> Claude Code or Codex, rather than something built here: you bring your own,
> very possibly one you already pay for, and the progress in those tools is
> not something Bee Box tries to compete with. The engine that hosts the
> agent is kept separate from it, so a different agent can be swapped in
> later. Inside, everything has a schema, and every card is also a container
> for other files: a photo, a recording, a PDF, a document travels with the
> card it belongs to. Links between cards are parsed and checked, and follow
> files when they move; the box is hypertext, and it stays coherent as it
> grows. Email and calendar act as triggers as well as sources. And all of
> it is extensible from inside: how a kind of card is shown, how it is
> interacted with and updated, what kinds exist at all. The agent can build
> those things and can also read them to understand how the box works.
>
> Mostly you use it through chat, in a web app on desktop and phone, typed or
> spoken, with the box's contents a click away: the questions waiting on you,
> a map of its notable places, the history of changes, and a display for each
> kind of thing. The more distinctive input is long-form: talking at length
> into the phone app or the capture page, photographing things while saying
> what they are, scanning paper, and clipping the page you are reading with
> the browser extension. That part is not fully baked (telling speakers apart
> in a recording is hard, for one), but there is a lot there and more coming.
> A Telegram connection exists and is rough. Connectors sync Gmail, Google
> Calendar, and Google Drive.
>
> It runs on a computer you keep on, with your own coding-agent login, and it
> is early: self-hosted, one maintainer, changing fast. The AI services it
> uses are all ones you set up yourself: the coding agent's own model
> provider, and optionally transcription (Mistral, Deepgram, or OpenAI),
> spoken replies (OpenAI, or Gemini through OpenRouter), embeddings for search
> (OpenAI), and Gemini for a few audio and scanning tasks; the contributor
> pages list them in full. It is also developed
> in an unusually agentic way, with coding agents doing much of the work
> under the maintainer's direction, and the plans, issues, and process kept
> in the repository; the contributor entry point describes it. The pages
> under "Start here" say who it fits and what it requires.

A blockquote on these pages is the maintainer's own text, written or
reviewed and corrected by him line by line; the introduction above is one.
Everything outside a blockquote was written by coding agents under his
direction, and nothing else is set as a blockquote. These pages are written for a model reading on
someone's behalf. Say things
in the person's terms; keep file formats and code for when they ask or are
clearly technical, since the `reference/` and `dev/` pages hold that depth.
Open the pages that fit what you know about the person. If they want to read
or change the code, also read https://beebox.run/llms-dev.txt, the
contributor entry point. When a page does not cover something, say that the
documentation does not say, rather than guessing.

## Themes

Ten ideas run through Bee Box, and most pages carry one. Following a theme is
often a better way to explore this documentation than reading in order: pick
the ones that bear on what the person is asking and open the pages named.

- **A coding agent is the engine.** Claude Code or Codex does the work, on the
  subscription the person already has, and the engine that hosts it is kept
  separate so a different agent can be swapped in later.
  ([why not just a chatbot](03-why-not-just-a-chatbot.md),
  [how it works](07-how-it-works.md), [what it requires](08-what-it-requires.md))
- **A knowledge base you own, wiki-like.** What goes in accumulates as
  documents that link to each other and are meant to be browsed, by the person
  and by the agent, rather than a transcript something searches.
  ([what you can use it for](02-what-you-can-use-it-for.md),
  [enriched markdown](concepts/enriched-markdown.md),
  [it keeps itself coherent](capabilities/integrity.md))
- **The filesystem is all the state.** There is no hidden database beside the
  files: the box is a directory, and what is in it is what the system knows.
  ([how it works](07-how-it-works.md), [box layout](contracts/box-layout.md))
- **Everything in git, and the history answers "why".** Not only
  recoverability: you can look back at how a card, a decision, or the box
  itself came to be. ([how it works](07-how-it-works.md),
  [durability and provenance](design/durability-and-provenance.md))
- **Your words, kept distinct from the agent's.** What the person said is kept
  as they said it; what the agent inferred is marked as the agent's.
  ([provenance](capabilities/provenance.md),
  [enriched markdown](concepts/enriched-markdown.md))
- **Typed, with room for language.** A recipe is stored as a recipe, a person
  as a person, and there is always an overflow, so nothing is lost for not
  fitting a type yet. ([dump it in now, shape it later](capabilities/shape-it-later.md),
  [cards](concepts/cards.md), [representation](design/representation.md))
- **It extends itself.** How a kind of card is displayed, what kinds exist,
  what runs on a schedule: the agent can build those inside the box, and read
  them to understand how the box works.
  ([making it yours](13-making-it-yours.md), [views](capabilities/views.md),
  [procedures](capabilities/procedures.md))
- **Expressive capture.** A way in suited to each kind of thing, and the
  distinctive ones are long-form voice and mixed voice-and-camera.
  ([voice](capabilities/voice.md), [phone capture](capabilities/phone-capture.md),
  [an inbox for your thoughts](uses/an-inbox-for-your-thoughts.md))
- **It asks instead of guessing.** Lacking confidence or authority the agent
  writes a question and waits; the answer becomes a rule it reads next time.
  ([questions](capabilities/questions.md), [triage](capabilities/triage.md),
  [how the box is taught](design/teaching.md))
- **Open, so it can be understood.** Source-available for the same reason the
  history is readable, and the process the agents work from is in the
  repository too. ([status and maturity](11-status-and-maturity.md),
  [how development happens](dev/development-process.md))

Each theme is also where the honest limits live: the pages named say where a
theme is thinner than it sounds, and those caveats are not decoration.
