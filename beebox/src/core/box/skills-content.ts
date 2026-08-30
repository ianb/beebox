/**
 * Content for the managed box skills installed by `generateSkills`
 * (box-skills.ts). Kept separate so the provisioning logic stays small and the
 * skill prose reads on its own. Authored as escaped-backtick template literals,
 * the same pattern as schema `instructions`.
 *
 * NOTE: this is agent-facing prose under review — the boxholder reviews the
 * skill before it ships. See docs/implemented-plans/courseware-phase1.md (Track 5).
 */

/** The `build-course` skill: the pedagogical process for building a course. */
export const BUILD_COURSE_SKILL = `---
name: build-course
description: Build or revise a learning experience (a course) WITH a learner — probe what they understand, map the knowledge, plan how to present it, and track evidence-backed progress. Use when asked to teach a topic, create a course/lesson/tutorial, help someone learn or understand something, or revise/extend an existing course.
---

# Building a course

A **course** is a learning experience you build *with* a learner on one bounded topic. You don't write it cold and hand it over — you probe, design, and adapt, keeping your reasoning in the cards so later changes stay coherent.

This skill orchestrates five card types. Each has its own card-rule with the field details — read the rule when you open a card of that type:

- \`course\` — the manifest that binds everything.
- \`concept-map\` — the knowledge graph (concepts as nodes, typed edges).
- \`exposition-plan\` — the plan for how to *present* the material, with the reasoning kept in.
- \`lesson-plan\` — the ordered delivery flow: segments tagged *interactive* (live in chat) or *material* (a pre-made card).
- \`progress\` — a separate, per-learner, evidence-backed record of what the learner understands.

The actual teaching material lives as \`doc\`/\`figure\` cards in the course's \`material/\` subdirectory (never a stray \`README.md\`). Once built, a course is *run* as a tutoring chat scoped to its attach directory — reached from a \`landmark\` (step 7).

Write all of these cards with **neutral pronouns** (they/them) for the learner, whoever they are.

## The process

It is not a rigid pipeline — probing comes early and the rest follows from what it surfaces. Revisit and adapt freely.

### 1. Probe — to understand, not to test

Before designing anything, understand what the learner knows — the full, real picture. You are **not** testing or challenging them, and this is not a quiz. Think of a Piagetian clinical interview: curious, following their thinking wherever it leads. Ask open-ended questions anchored in a concrete, familiar phenomenon, aimed at their mental model:

> "What do you think is actually happening when you mix baking soda and vinegar?"

One good phenomenon-question surfaces a lot, in their own words. Chase the reasoning behind an answer; branch on what they say.

Aim for the *fullness* of what they understand — including the parts they can't yet name. Some real understanding is **obscured by ignorance elsewhere**: a missing word, or a gap in a neighboring idea, can make a learner seem to know less than they do. Dig past that, and give them room to show what they grasp. Notice misconceptions too — not to correct on the spot, but because a confidently-held wrong model is part of the real picture and shapes what to teach. It's fine to gently check things they seem sure of, as well — not to catch them out, but so the picture is honest in both directions.

Stop when you have enough to design — don't drag it out.

**This step is the default, but not always possible.** If you are building for an unknown/future learner (no one to probe), skip it: build for a sensible model learner, and probe for real the first time someone engages.

### 2. Set the success criteria

Find out — and write down — what would count as *understanding this, for this learner*. Casual and personal, not a standardized objective: "can predict whether a reaction fizzes and explain why, without naming every ion." Pay attention to the *deeper* why behind the request (a better mental model? a specific task?). Set this **early**: it is the lens for what belongs in the graph and what to emphasize. It goes in the course's \`success-criteria\`.

### 3. Build the concept-map

Lay out the concepts between where the learner is and where they want to be, and draw the typed edges between them. Assign each node its KC \`kind\` (it steers *how* you teach it), and — where the intended level isn't obvious — a target Bloom \`depth\`; together they tell you how to teach it later. On each node, note the **common** misconceptions for that concept — what learners *typically* get wrong, so the teaching can preempt them (the *specific* misconceptions this learner showed go in the \`progress\` card, not the map). Let genuine spirals be \`complements\` cycles — don't force a clean line where the subject is genuinely circular.

**Tune how far back the map starts to what you actually know about the learner.** If you have a real read on where they are (you probed them, or the course's \`audience\` names a specific person), start near their *edge*: assume what they already have — say it in a sentence rather than making it a node — and node-ify only what you'll actually teach toward the \`success-criteria\`. If you *don't* have enough to judge (a \`generic\` course, or no probe), starting more completely from the foundations is the right move — you can't assume what they know. **Completeness is the low-information fallback, not the default.** (See the concept-map card-rule for the node fields and the edge-type rubric.)

**Then review the map before you build on it.** Read it back against the card-rule's shape rules — no orphan nodes, no degenerate straight-line chain, every edge a real relation, names that are entities not questions, scoped to fit. A course is usually built automatically (the learner can't validate the graph), so this self-review is the quality gate the map gets; the orphan lint catches one class, but the rest is your read.

### 4. Seed progress — grounded in what you saw

Write a **sparse** \`progress\` card from what the probe surfaced — an entry only for the nodes you actually have signal on, **not a sweep of the whole map** (an unlisted node means "not assessed yet"). Each entry records what the learner actually said or did (the \`evidence\`) and how you read it (\`observed\` / \`inferred\` / \`self-report\`), so the record reflects your real understanding rather than a guess. A handful of real entries beats a wall of "not directly probed" filler. Update it as you learn more.

### 5. Plan the exposition

Work out how to *present* this material — in the \`exposition-plan\` card, in this order:

1. **Translate the learner into style first.** Turn what you know about them — and whether this is a \`generic\` course or for a specific person (set the course's \`audience\`) — into concrete implications for *how* to present. This guides the ratings below.
2. **Enumerate and rate approaches.** List the candidate ways to present, and rate each for *this* material and learner. **You over-reach for plain prose — deliberately consider non-textual options** (dialog, a figure/manipulable, a diagram, contrasting cases, an analogy) and say why each does or doesn't fit. But never use a technique just because it exists; each must earn its place, and **mostly-textual is a fine answer if it genuinely fits** — variety is not the goal.
3. **Distill into \`rules\`.** Write a short list of concrete, standalone rules you can follow later without re-reading — they're compiled into a box rule that auto-loads while you work in this course.

(See the exposition-plan card-rule for the field details.)

### 6. Plan the delivery flow — and build the material it leans on

Now lay out *what actually happens, in order*, in the **lesson-plan** card: a sequence of segments, each either **interactive** (it plays out live in chat — eliciting their model, predict-and-explain, dialog) or **material** (a pre-made card carries it — a figure to manipulate, a doc to re-read). Each segment names the concept-map node(s) it advances. This is **distinct from the exposition-plan**: the exposition-plan decided *how and why* to present; the lesson-plan just *sequences* it. Most early segments are interactive — reach for a material card only where a made artifact genuinely beats live talk.

Don't author all the material up front, and don't do it in one pass — work the loop:

1. **Draft** the lesson-plan: the whole segment sequence, each tagged interactive or material.
2. **Author** only the material a segment actually leans on *and* that earns being made now (the one figure you'll reuse, a recap worth re-reading) — as **\`doc\`/\`figure\` cards under \`material/\`**, *never* a \`material/README.md\`. Follow the exposition-plan's rules and rated approaches. Keep answer keys beside the material, grounded in cited sources (see *Teaching well*). When a segment calls for a \`figure\`, make it **teach through interaction** — tie what the learner *does* to the concept's target Bloom level (*understand* → step through the mechanism; *apply* → manipulate and predict; *analyze* → compare or explore cases); a passive animation rarely teaches above *remember*. For making it usable and verifying it renders, follow the figure card-rule; for worked patterns in TypeScript, see \`figure-examples.md\` in this skill folder.
3. **Revise** the lesson-plan: mark each segment whose card now exists \`status: ready\` and ref it; mark the rest \`status: planned\`.

A \`material\` segment must end up either \`ready\` (its card exists) or \`planned\` (outlined, built later during teaching) — the lint warns otherwise, so deferral is honest, not hidden. **A mostly-interactive, mostly-\`planned\` course is a *complete* plan**; you are not expected to pre-build everything. The reasoning stays in the exposition-plan and the cards' bodies, so when you adapt later (step 8) the *why* travels with the work.

(If there's a real learner, their progress informs which segments to make concrete first; for a \`generic\` course there's no progress yet, and that's fine — draft for the model learner.)

### 7. Make it runnable — a landmark and a scoped CLAUDE.md

A built course still needs an **entry point** so it can be *taught*. A tutoring session is just a chat **scoped to the course's attach directory** (the folder holding all the components): opening it there makes the exposition rules and a course-local \`CLAUDE.md\` auto-load. Create three files in that attach scope:

1. A **landmark card** (\`<Course>.landmark.card\`) with a \`navigation\` role — this is what turns the course into a **chat destination** on the Landmarks page. Give it a short \`label\` (the course name), a \`symbol\`, and \`links\` to the course guide and the lesson-plan, each written as a full box path with a leading \`/\` (the guide is the \`*.course.card\` in the parent directory). (See the landmark card-rule for the fields.)
2. A thin, **editable \`CLAUDE.md\`** — a line or two naming the course and pointing at \`../<Course>.course.card\` (the guide), then \`@course-runner.md\` to include the generic runner instructions. Keep it minimal so you (or a later session) can amend it with course-specific notes; the boilerplate lives in the included file.
3. The **\`course-runner.md\`** it includes — the same for every course, so write it verbatim:

\`\`\`markdown
# Running a course

A chat opened here is a **tutoring session** — you teach this course, one-on-one with
the learner. (Building or revising one is the \`build-course\` skill; this is the *run*
side, where the course already exists.)

- The **course guide** is the \`*.course.card\` in the parent directory — read it first.
- Follow the **\`*.lesson-plan.card\`** here, in order: each segment is \`interactive\`
  (conduct it live, in chat) or \`material\` (open the card it refs under \`material/\`).
- Read the **\`*.progress.card\`** before starting, and **update it with evidence** as
  you go — every status needs what the learner actually said or did (no anonymous
  ratings).
- The **exposition rules** auto-load (a path rule scoped to this directory) — they're
  *how* to present. Follow them.

Probe first if there's no progress yet (a new learner — the \`build-course\` skill's
probe step is the guide). Work dialog-first, be Socratic, steer with answer keys
rather than reading them out, and amend the course cards when the plan needs to
change. Material (figures, recaps, sources) lives in \`material/\`.
\`\`\`

Opening a chat from the landmark scopes it to this directory, so the \`CLAUDE.md\` and the path-globbed exposition rules load automatically — the runner reads the course guide, follows the lesson-plan, and updates progress. You're not teaching in *this* build session; you're setting up so a future tutoring chat can.

### 8. Adapt as you go

Adaptation is expected and a good sign. As you learn more about the learner — or their goal shifts — amend the graph, re-plan the exposition, and update progress (with new evidence). Read the recorded rationale and extend it; don't silently overwrite it.

**Revising an existing course** runs the same loop against the existing cards: re-probe where needed, adjust, and log what changed and why.

## Teaching well

- **Be Socratic.** Guide the learner to reason rather than handing them answers — use the answer key to steer your questions, don't just state it. Meet them where they are; build on partial and correct-but-incomplete thinking instead of restarting.
- **Ground what you teach in sources.** Don't assert facts from memory — especially in answer keys and explanations. Bring the authoritative material into the box (e.g. a \`doc\` or \`webpage\` card) and cite it with the \`{% source %}\` pattern, so the learner can trace what they're told and the content stays trustworthy:

  > Acids {% source ref="/store/courses/Acids.attach/material/Acids_Bases.doc.card" %}donate protons{% /source %} in solution.

  A bare \`{% source ref="..." %}…{% /source %}\` anchors a span to a cited card; use \`href="..."\` to cite an external URL instead. (See the box's source-tagging convention for the full pattern.)
- **Classify a claim before you lean on it.** Is it solidly *verified* by the source (cite it), *directional* (the effect holds but the exact figure varies — say so), or only *qualitative*? Cite at the strength the source supports. If a claim is *unsupported*, leave it out or name the uncertainty — **missing or fuzzy data is a fine thing to state plainly; never fabricate to fill a gap or to make two sides look balanced.**
`;

/**
 * Supplementary worked-figure examples, installed beside the build-course skill
 * as \`figure-examples.md\` and referenced from the material step. Kept out of the
 * main skill so it stays lean; the agent loads this on demand when authoring a
 * \`figure\`. The example sketch code deliberately uses no template literals (so it
 * survives this enclosing template literal) — author real figures however you like.
 */
export const FIGURE_EXAMPLES = `# Figure examples

Worked patterns for \`figure\` cards. A figure's runnable code is a \`.ts\` module in
the card's attach scope (\`entry: attach/sketch.ts\`) that **default-exports
\`(lib, { mount, figure }) => teardown\`**: \`lib\` is the runtime (p5/three/d3),
injected by the harness — *never import it*; \`mount\` is the DOM element; \`figure\`
carries \`{ params, data, meta, file }\` (coerced embed params, the card's \`data\`,
validated frontmatter \`meta\`, file helpers). Return a teardown for p5/three.

Always **verify a figure renders** (open + screenshot, controls visible, nothing
clipped) before calling it done.

## 1. Minimal interactive (p5) — the contract

\`\`\`ts
// attach/sketch.ts — click to toggle. Shows the required shape: instance-mode p5
// sized to the container (never a fixed pixel width), and a teardown that
// disconnects the observer and removes the instance.
export default function (p5, { mount, figure }) {
  const width = () => Math.min(mount.clientWidth || 360, 640);
  const instance = new p5((p) => {
    let on = false;
    p.setup = () => p.createCanvas(width(), 200);
    p.mousePressed = () => { on = !on; };
    p.draw = () => {
      p.background(28);
      p.fill(on ? p.color(120, 200, 120) : p.color(90));
      p.circle(p.width / 2, 100, 80);
    };
  }, mount);
  const ro = new ResizeObserver(() => {
    if (instance.width !== width()) instance.resizeCanvas(width(), 200);
  });
  ro.observe(mount);
  return () => { ro.disconnect(); instance.remove(); };
}
\`\`\`

## 2. Categorization sort (p5, data-driven)

A reusable *practice* pattern for a \`concept\` node (recognize instances → Bloom
*apply*): the learner sorts each item into its category. Author the items and
categories in the figure card's \`data\` field, read here as \`figure.data\` — so the
content is editable without touching code.

\`\`\`yaml
# in the figure card frontmatter
data:
  items:
    - { text: "vinegar", category: "acid" }
    - { text: "baking soda", category: "base" }
  categories: ["acid", "base"]
\`\`\`

\`\`\`ts
// attach/sketch.ts — click the bucket you think each item belongs in.
export default function (p5, { mount, figure }) {
  const items = figure.data.items;       // [{ text, category }]
  const cats = figure.data.categories;   // ["acid", "base", ...]
  const width = () => Math.min(mount.clientWidth || 420, 640);
  let i = 0, score = 0, feedback = "";
  const instance = new p5((p) => {
    // Layout derives from p.width (not a captured constant) so the buckets
    // fit a phone column and reflow when the container resizes.
    const buttons = () => {
      const bw = Math.min(120, (p.width - 40) / cats.length - 10);
      return cats.map((c, k) => ({ c, x: 20 + k * (bw + 10), y: 150, w: bw, h: 36 }));
    };
    p.setup = () => p.createCanvas(width(), 220);
    p.mousePressed = () => {
      if (i >= items.length) return;
      for (const b of buttons()) {
        const hit = p.mouseX > b.x && p.mouseX < b.x + b.w && p.mouseY > b.y && p.mouseY < b.y + b.h;
        if (hit) {
          const right = b.c === items[i].category;
          if (right) score++;
          feedback = right ? "Yes" : "Not quite; it's " + items[i].category;
          i++;
        }
      }
    };
    p.draw = () => {
      p.background(28);
      p.fill(235); p.textAlign(p.CENTER, p.CENTER); p.textSize(18);
      p.text(i < items.length ? items[i].text : "Done: " + score + "/" + items.length, p.width / 2, 70);
      for (const b of buttons()) {
        p.fill(60, 70, 90); p.rect(b.x, b.y, b.w, b.h, 6);
        p.fill(230); p.textSize(13); p.text(b.c, b.x + b.w / 2, b.y + b.h / 2);
      }
      p.fill(150); p.textSize(12); p.text(feedback, p.width / 2, 110);
    };
  }, mount);
  return () => instance.remove();
}
\`\`\`

This is *practice*, not assessment — it feeds the learner's understanding in the
moment; it does **not** write a \`progress\` status (that comes from real dialog).

## Other runtimes

\`three\` (3D scenes) and \`d3\` (data-driven SVG, including node-link graphs via
\`d3-force\`) use the same export shape; pick the runtime that fits the content
(\`runtime: three\` / \`runtime: d3\` in the card). See the figure card-rule for the
full field reference.
`;

/**
 * The `calendar` skill: authoring `.ics` events for two-way Google Calendar
 * sync. A static constant: the box's timezone is referenced by the `BOX_TZ`
 * placeholder (already on the `Timezone:` line in the agent's system context),
 * and the box-specific VTIMEZONE block is fetched at author time with
 * `bbx calendar vtimezone` rather than baked in (hand-writing DST rules is
 * exactly the error this prevents).
 */
export const CALENDAR_SKILL = `---
name: calendar
description: Work with the box's calendar — view, create, edit, or delete Google Calendar events by authoring .ics files in store/calendar/. Use when scheduling, adding/changing/removing an event, setting up a meeting or appointment, or any task that touches the box's calendar.
---

# Calendar

Calendar events live as \`.ics\` files in \`store/calendar/\`. Sync with Google Calendar is **two-way**:

- **View events:** \`bbx calendar\` shows upcoming events (\`bbx calendar today\`, \`bbx calendar 2w\`, …).
- **Create an event:** write a new \`.ics\` file in \`store/calendar/\`. The next sync pushes it to Google Calendar.
  - Include \`X-BBX-CALENDAR-ID:<calendar-id>\` to target a specific calendar (defaults to primary).
  - Optionally include \`X-BBX-REASON:<why>\` and \`X-BBX-REF:<path>\` for tracking.
- **Edit an event:** modify a tracked \`.ics\` file directly. The next sync pushes the changes.
- **Delete an event:** add an \`X-BBX-DELETE:<reason>\` property to a tracked \`.ics\` file. The next sync deletes it from Google Calendar.
- **\`store/calendar/stranded/\`** holds edits Google would never take (the event was deleted there, or the push failed for a week). They are not synced. Move a file back up into \`store/calendar/\` to push it as a new event, or delete it.

**Timezone requirement:** non-all-day events MUST include a VTIMEZONE component and a TZID parameter on DTSTART/DTEND. Never create floating-time events — they'll be rejected.

- \`BOX_TZ\` in the example below is this box's timezone — it's on the \`Timezone:\` line already in your system context (or run \`bbx calendar vtimezone\`, which prints it). Substitute it wherever \`BOX_TZ\` appears.
- Get the box's exact VTIMEZONE block by running \`bbx calendar vtimezone\` and paste it verbatim into the VCALENDAR (hand-writing DST rules is error-prone).

Example minimal \`.ics\` for a new event:

\`\`\`
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Bee Box//EN
<paste the output of \`bbx calendar vtimezone\` here>
BEGIN:VEVENT
UID:unique-id-here
SUMMARY:Dentist appointment
DTSTART;TZID=BOX_TZ:20260401T140000
DTEND;TZID=BOX_TZ:20260401T150000
X-BBX-REASON:confirmed in the reschedule email
X-BBX-REF:/store/archive/Dentist_Reschedule.email-message.card
END:VEVENT
END:VCALENDAR
\`\`\`
`;

/** The `drive` skill: reading/editing/syncing Google Drive sheets and docs. */
export const DRIVE_SKILL = `---
name: drive
description: Work with Google Drive content in the box — mirror a folder, sync a spreadsheet (.gsheet.card) or document (.gdoc.card), or keep a pointer to a file. Use when a task involves a Drive link, a Drive-synced file, or bbx drive commands.
---

# Google Drive

## Three kinds of Drive card

- **Pointer** (\`.glink.card\`) — "this Drive item exists, here is where, here is what it's for." Nothing is copied. \`name\`/\`link\`/\`mime\` are connector-stamped; the body is yours for purpose notes.
- **Synced file** (\`.gdoc.card\`, \`.gsheet.card\`) — content mirrored **two-way**, kept in the card's attach scope (\`<basename>.attach/\`). \`bbx mv\` moves the card and everything with it; the \`drive-id\` keeps the upstream link. Don't move the pieces by hand.
- **Mirrored folder** (\`.gfolder.card\`) — the directory the card sits in mirrors the Drive folder. Docs and Sheets become synced files, subfolders become subdirectories with their own folder card, and **every other child becomes a pointer** — a PDF, a Slides deck, an image is never copied.

## Setting one up: the boxholder pastes a Drive link in chat

That is the normal path (the settings page is the other one). Use \`bbx drive list <folder-url>\` to see what a folder holds before mirroring it, then:

- "mirror this" / "keep this folder in the box" → \`bbx drive mount <folder-url> <dir>\`. **There is no default directory** — propose one that fits how the box is organized and say why; if you can't tell where it belongs, ask.
- "keep a pointer to this" / "just remember this exists" → \`bbx drive link <url> <path>\`
- one Doc or Sheet, synced two-way → \`bbx drive add <url> <path>\`

## The directory IS the mount

There is no config file — the folder card's own location is the configuration. \`bbx mv\` on the card re-homes the mirror: the next sync mirrors into its new directory and the children left behind stay as ordinary cards. Move the whole *directory* and the mount travels with its children, which is usually what you want.

- **Unmount:** \`bbx drive unmount <dir-or-card>\`. Discovery stops; every child stays exactly where it is, synced ones still syncing. Nothing is deleted.
- **Stop one file:** \`bbx rm <card-path>\` — the card and attach scope move to \`store/trash/\`, a durable tombstone a mirror will not undo. Restore from trash, or \`bbx drive add\` again, to resume. A child **trashed on Drive** lands there too, and the sync says so; a child *moved out* of the folder is left alone and keeps syncing.

## Inside a synced file

- **Sheet tabs:** each tab is a JSON file in the attach scope, referenced from the card. Plain cells are bare values; formula cells are \`{"f": "=SUM(A1:B1)", "v": "$42.00"}\` — formula and computed result. Edit the JSON (for a formula cell, the \`f\` field) and commit; the next sync pushes it.
- **Doc body:** markdown at \`attach/<basename>.md\`. Edit it and commit, and the next sync converts and pushes it.
- **Comments:** a \`<basename>.comments.json\` sidecar in the attach scope holds the full threads (author, timestamps, resolved status, anchored text, replies), read-only. Editing and pushing a Doc's \`.md\` does NOT write comments back upstream — a push may even orphan the upstream anchors.
- **Lossy content:** a Doc card's \`lossy:\` frontmatter lists upstream features that don't survive markdown export (footnotes, embedded images, equations, suggestions, complex tables). When it's non-empty, pushing local edits will destroy them — surface the loss before encouraging a push.
- **Conflicts:** when both sides changed, the card status flips to \`conflict\` and the upstream content is written to \`attach/<basename>.remote.md\`. Merge the two, delete \`.remote.md\`, commit.

Also: \`bbx drive inspect <url>\` (preview one item), \`bbx drive sync\` (all Drive cards), \`bbx drive status\` (what this box has mounted).
`;

/**
 * The `email` skill: the doorway from "email someone" to an email-outbound
 * card. The field-level reference (headers, threading, lifecycle) lives in the
 * email-outbound schema's own instructions, which load via the card rule when
 * the card exists — this skill covers the intent, where the card goes, and how
 * to write it, then hands off.
 */
export const EMAIL_SKILL = `---
name: email
description: Draft or reply to an email for the user to review and send. Use when asked to email someone, reply to a message, follow up by email, or send anything that isn't a chat or Telegram reply.
---

# Email

You don't send email directly — you **draft** it, and the user reviews and sends. A draft is an \`email-outbound\` card; the Gmail connector picks it up on the next sync and creates a Gmail draft.

## Create the draft

- **Replying** to a thread: put the draft inside that thread's attach scope, beside the message you're answering — e.g. \`box/inbox/email/<thread>.attach/draft-001.email-outbound.card\` — and set \`in-reply-to.ref:\` to the source \`.email-message.card\` (a path relative to the draft, usually just the sibling filename) so Gmail threads it correctly.
- **A new email** (no thread): a fresh card under \`box/inbox/email/\`.

\`bbx create <path> -t email-outbound\` scaffolds one. The field details — required headers, threading, lifecycle — are in the \`email-outbound\` card's own instructions, which load when you create or open it. Follow them.

## How to write it

- It's a draft on purpose: the user has the last word before anything leaves the box. Compose the *whole* message — don't hand them a half-written stub to finish.
- Match the user's voice and their relationship to the recipient (read the person card if there is one). A note to a sibling isn't a note to a landlord.
- Only real recipients — never invent an address. If you don't have one, say so or raise a question card.

If the user only wants to *know* about an email they received, that's \`bbx search --kind email-message\`, not a draft.
`;

/**
 * The `location` skill: the box's on-demand location surface (reading the
 * user's shared device location + teaching named places). Moved out of the
 * always-loaded guide — location never appears in context automatically, so
 * an agent only needs this when a task actually turns on where the user is.
 */
export const LOCATION_SKILL = `---
name: location
description: Find where the user is, or teach the box a named place (Home, Office). Use when a task needs the user's current whereabouts, or to record or recognize a location by name.
---

# User location

The boxholder can share their device location from the web UI. It is **on-demand only** — it never appears in your context automatically, so query it when the conversation needs it. It comes from the browser, so it stays \`unknown\` on Telegram and other channels.

- **Read it:** \`bbx location get\` prints the last-known fix as \`lat,lng (±accuracy, captured <age> ago, web)\`, prefixed with the place name (\`Home — …\`) when the fix is inside a known place. Add \`--json\` for structured output (\`place\`, \`lat\`, \`lng\`, \`accuracy\`, \`capturedAt\`, \`ageMs\`, \`stale\`).
- **Not shared:** prints \`unknown\` when the boxholder hasn't shared location. Don't guess or fabricate a location — report that it's unknown.
- **Staleness:** an old fix is flagged \`[stale]\` (and \`stale: true\` in JSON); treat it as approximate.

## Named places

Place cards (\`places/<Name>.place.card\`) let the box recognize a location by name — so \`bbx location get\` can say "Home" instead of bare coordinates.

- **Record a place (card first, then mark):** create the card describing the place — \`bbx create places/Home.place.card name=Home address="…"\` — with a body explaining what it is and why it matters. Then, while the boxholder is physically there, run \`bbx location mark places/Home.place.card\` to stamp the current location into it. Don't hand-type \`lat\`/\`lng\` — \`mark\` writes them from the live fix and reports the fix's age so you can judge whether it's current.
- **Outside the radius:** if the boxholder is now outside a place's radius, \`mark\` won't change it; re-run with \`--expand\` to grow the radius to include the new spot.
`;

/**
 * The `schedules` skill: authoring a scheduled-script card so the box does
 * something later or on a cadence. The description is the discovery surface —
 * an agent forms the "come back to this later" intent from it — while the card
 * format lives in the scheduled-script card's own docs.
 */
export const SCHEDULES_SKILL = `---
name: schedules
description: Have the box do something later or on a cadence — a reminder, a recheck, a periodic job that runs on its own. Use when you want to return to something after this turn, revisit a decision at intervals, or run a command on a schedule.
---

# Schedules

A scheduled script — a \`.scheduled-script.card\` in \`config/schedules/\` — runs a \`bbx\` command on a recurring schedule, or once at a future time. The built-in ones are mechanical (connector syncs, maintenance); the ones **you** create serve the user: checking something on a cadence, revisiting a decision at intervals, or a one-off further out than a chat \`<schedule>\` can reach. Keep them practical, not dramatic.

\`\`\`
---
cron: 0 8 * * 1              # Mondays at 8am
not-before: 3d              # skip if it already ran within 3 days
runs: bbx procedure run weekly-digest
description: Monday digest of the week's still-open threads
source: Boxholder wanted a summary to start the week
---
\`\`\`

They run in the background automatically; \`bbx scheduled\` lists them. Use \`at:\` (a future timestamp) instead of \`cron:\` for a one-shot. Full format — cron/at/rrule, \`not-before\` throttling, \`create-after-success\` chaining — is in \`docs/generated/card-scheduled-script.md\`.

(This is for durable, box-level schedules. A quick in-session follow-up while chatting — "remind me in 20 minutes" — is the chat \`<schedule>\` tag, not a card.)
`;

/**
 * The `tricks` skill: formalizing a repeated operation as a reusable script.
 * The trigger is *self-noticing* ("I keep doing this"), so the description
 * carries that instinct — nothing else in context plants it once this leaves
 * the always-loaded guide.
 */
export const TRICKS_SKILL = `---
name: tricks
description: Formalize a repeated operation as a reusable script you can rerun with bbx trick. Use when you notice you're doing the same multi-step task by hand more than once (a particular fetch, an export, a search-and-summarize) and want to package it.
---

# Tricks

A **trick** is a reusable script — you package a useful operation once and rerun it with \`bbx trick <name>\`, instead of redoing it by hand each time. The signal to make one is *repetition*: the second time you find yourself running the same multi-step task, that's when it's worth formalizing.

Each trick lives in \`src/tricks/scripts/<name>/\` with an \`index.ts\`. Read \`src/tricks/scripts/CLAUDE.md\` for the authoring shape (the script environment, arguments, how it's invoked) before writing one.

Tricks are box-local by default, but the operation itself needn't be box-specific — a general utility (an image generation, a format conversion) is a fine trick if it's something this box does repeatedly.
`;

/**
 * The `views` skill: authoring a .tsx view. Rare, mechanics-heavy box-building
 * work — out of the always-loaded guide, reached when a card type needs a
 * richer interface than the default renderer.
 */
export const VIEWS_SKILL = `---
name: views
description: Give a card type a custom interface — a React component that renders a card in the browser. Use when a card type needs a richer display than its default renderer.
---

# Views

Views are React (\`.tsx\`) components that render box data in the browser. **Read \`docs/generated/views.md\` before creating or modifying one** — it carries the full API, the view-host context, and how to test a view.

A view always gives a **card type** a custom interface: a view exporting \`rendersCardTypes = ["<type>"]\` becomes that type's UI on card pages, peeks, and chat embeds, and is selected on a card's path with \`?view=name\`. Every view is attached to a card type this way — there is no card-less standalone view.

When the user says a view "looks wrong" and the source doesn't tell you why — a broken layout, a visual glitch, something rendering unexpectedly — run \`bbx chat screenshot\` to see what's actually on their screen right now instead of guessing from the code. It asks the user's browser, so it may come back declined or unavailable; reach for it when appearance is genuinely the question, not by reflex. When the question is *where* a control is rather than how something looks, \`bbx chat ui\` lists the controls on screen and the \`control:\` links that point at them — same rule: reach for it when interface location is genuinely the question, not by reflex.
`;
