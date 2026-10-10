---
title: "Plugins: design"
status: implemented
workstream: plugins-planning
issues: []
---
# Plugins: design

**Parent plan:** [plugins.md](plugins.md)

Most of the plan is infrastructure. Two things reach a person: what the agent
says when asked for something a plugin provides, and what a box with an
inactive or half-activated plugin shows. This design covers those two.

## Situations

- When Priya asks the box in chat for "a chemistry course for Wren", and the
  box has never held a course, I want the agent to know that courseware
  exists and set it up in this conversation, so I get a course and not "I
  can't do that".
- When Tomas opens the box's status page after an engine upgrade and the box
  already holds course cards from before, I want to see one line saying the
  course types need the courseware plugin activated and who can do it, so
  the cards are not silently unknown.
- When Priya has never asked for anything course-shaped, I do not want course
  types, course skills, or a courseware line in the agent's guide or in my
  card lists, so the box stays about what I use it for.
- When Juni's course has outgrown the plugin's progress card and the agent
  adds a `mood` field for her, I want that addition to survive engine
  upgrades, so the box's own work is not overwritten.
- When Priya says "we're done with courses", I want the agent to be able to
  deactivate courseware and tell me what stays (the course cards and the
  stubs) and what goes (the skill), so nothing disappears without being
  named.

## Right place, right time

| Situation | Act, show, or quiet | Surface and card | Attention |
|---|---|---|---|
| Asked for a course, none active | Act: the agent runs `bbx plugins list`, reads the README, lists the plugin, writes the stubs, then builds the course | Chat; `_config/box.json`; new stubs under `src/` | Interrupts (it is the conversation) |
| Upgraded box with course cards, plugin inactive | Show: one health line naming the plugin and the fix | Status page health section, `bbx health`; the briefing's health alert if one is configured | Waits to be found; the existing health alert path if errors escalate |
| Never asked for courses | Quiet: no types in the guide, no skill, one standing "other plugins" line | Agent guide only | Background |
| Agent extends a progress card | Quiet: the stub is box code; the agent commits it like any schema | `src/schemas/progress.ts` | Background |
| Deactivation | Act, with a named summary in chat | Chat; `_config/box.json` | Interrupts (asked for) |

The health line appears at upgrade time and not earlier because that is the
moment the cards stop validating; a warning before the upgrade would be about
a future the box cannot see yet (principle 13: show the state the system is
in).

## Spirit

- **Serves:** *You should be able to see the gears.* `bbx plugins list` and
  the stubs are the gears. What a plugin added to this box is a listing of
  files the person can open, and a line in box.json.
- **Serves:** *It should feel possible.* The agent can say yes to "a course"
  and show the pieces it set up, instead of a feature that was always there
  and never explained.
- **Risks:** *It should feel like a place.* A box that accumulates stubs for
  things nobody uses stops feeling like Priya's. Guard: nothing activates by
  default, deactivation is one conversation, and `plugin-stub-inactive` keeps
  leftovers visible.

## Trust

Per `design/trust.md`, question then confirmation then automatic:

- **Activating a plugin** (editing box.json, writing stubs) starts at
  confirmation: the agent says what it will add and does it in the same turn
  unless the person objects. It is reversible and inside the box. It does not
  climb to automatic: a plugin activation is a visible change to what the box
  is about, and the person should hear it each time. Recorded nowhere;
  there is no learned trust for it.
- **Deactivating** starts at question: the agent names what stays and what
  goes and waits. Stubs are never deleted automatically.
- **Health checks** show only, take no action.
- **Extending a base** (adding a field in a stub) is ordinary schema work and
  follows the existing schema-change trust, which is confirmation in chat.

## When it goes wrong or does nothing

- The agent lists a plugin name that does not exist: `bbx status` shows
  *"box.json names an unknown plugin: coursware. Installed plugins: courseware
  …"*. The agent fixes the spelling.
- The agent lists the plugin but writes no stubs: the skill appears, and
  `bbx health` says *"courseware is active but no schema defines course; see
  node_modules/beebox/src/plugins/courseware/README.md, Setup"*
  (`plugin-declared-missing`), plus the card count line if course cards
  exist (`plugin-type-unprovided`).
- Cards exist for a type nobody provides: *"3 cards of type course have no
  schema. The courseware plugin provides it; run `bbx plugins list` and see
  its README."*
- The plugin is gone from the engine after an upgrade: the upgrade's
  typecheck fails on the stub by file name and the box is reset to before the
  upgrade. The release notes name the replacement.
- Nothing to do: a box with no plugins active shows one guide line and
  nothing else. `bbx plugins list` prints every installed plugin as
  inactive.

Wording: name the file, the plugin, and the command. No "oops", no
exclamation marks.

## Walkthrough

Priya, in chat: "Can you set up a chemistry course for Wren?"

1. The agent's guide has no course type. It has one line: *Other plugins:
   `bbx plugins list`.* It runs it and sees `courseware (inactive): Courses,
   lesson plans, learner progress. Docs: node_modules/beebox/src/plugins/courseware/README.md`.
2. It reads the README's Setup section: add `"plugins": ["courseware"]` to
   `_config/box.json`; write `src/schemas/course.ts` and four siblings from
   the shown stubs; write `src/views/concept-map.tsx`.
3. It tells Priya: *"This box has a courseware plugin that isn't on yet. I'll
   turn it on, which adds course, lesson plan, progress and concept map card
   types. Then I'll draft the course."* It does so and commits: box.json, six
   stubs. `bbx validate` passes; `bbx view typecheck` passes.
4. The next guidance sync mirrors the `courseware` skill into
   `.claude/skills/courseware/SKILL.md`. The agent guide's card-type list now
   shows the five types with their briefs, because the stubs define them.
5. The agent drafts `Wren/Chemistry/chemistry.course.card` and the rest, as
   the skill describes.
6. Priya sees the new cards in her box and, if she looks, a status page with
   every health check passing. `git log` shows one commit "Activate
   courseware plugin" and one for the course.

Record left behind: one line in box.json, six stub files, one skill
directory the engine owns, the course cards.
