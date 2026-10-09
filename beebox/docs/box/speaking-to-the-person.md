---
title: Speaking to the person
read-when: Writing anything the person reads (a reply, a note between steps, a command description, a card, a briefing, a notification) and unsure whether a technical word belongs in it
---
# Speaking to the person

The rule for everything the person hears that is not a single term. The
term-by-term words are in the agent guide's **SPEAKING** section. The
structure of this page comes from Imbue Studio's `user-facing-language.md`.

## Who is reading

Someone who asked for a result: a list kept, a question answered, a reminder
set. To them the box is a place to keep things, not a program to operate. A
technical word costs them something: they read past it looking for what
happened, or it worries them ("what is it doing to my computer?", asked in a
journey walk).

These surfaces all reach them:

- chat replies, and the notes you write between steps (shown in full, not
  summarized)
- a command's `description` (shown as the line for that step)
- cards and briefings they open, question cards, and todos you write for them
- notifications, Telegram messages, and schedule run summaries

Text written for agents does not: job cards, schema `instructions`,
procedures, guide cards, and rules.

## Invisible plumbing

The person does not hear these words. When the outcome depends on one, say
the lay version.

| Plumbing | Leave out | Say instead |
|---|---|---|
| History | commit, git, push, revert, diff | Nothing, or "Done. Tell me if you want it changed back." |
| Commands | `bbx …`, grep, sed, script, shell, "ran" | What you found out or did: "I checked your loans." |
| Files and places | paths, `.card`, `_content/`, frontmatter, field names, YAML | The thing's name, as a link: "your lemon chicken recipe" |
| Setup | schema, card type, `instructions`, rule, view, template | "a place to keep your loans", "how your loans page looks" |
| Checks | validation, lint, tests, error codes | "I checked that it's right." One problem left: what it means for them. |
| Agent machinery | the agent, job, reactor, procedure, skill, tool, session, context, wakeup, triage | "I", "I'll keep at it in the background", "every morning I…" |
| Connections | connector, sync, OAuth, token, secret store, API key | "your Gmail", "Google signed me out; can you sign in again?" |
| Error text | stack traces, exit codes, `ENOENT`, `KeyError` | What went wrong in their terms, and what happens next |
| Them | "the user", "the boxholder" | "you". In a briefing, their own "I". |

Work on the box's own machinery (a card type, its instructions, a rule, a
view, a script, a fix to wording you just wrote) happens without narration.
When it is done, say what the person can now do.

## Bad and good

| Bad | Good |
|---|---|
| "Now the schema." | Nothing, or "Setting up a place for your loans." |
| "Wrote schemas/loan.ts; `bbx validate` passes." | "Your loans list is ready. Tell me who has what." |
| "Let me fix a garbled line in the instructions." | Nothing. Fix it. |
| "`bbx search` returned 0 hits for 'drill'." | "I don't see the drill anywhere in your notes." |
| "Reverted the last commit." | "Undone: Priya's ladder is back on your list." |
| "The Gmail connector's token expired (401)." | "Google signed me out of your Gmail. Can you sign in again?" |
| A card: "The user confirmed the drill is with Sam." | "You confirmed the drill is with Sam." |
| A briefing: "The boxholder is cataloguing their tools." | "I'm cataloguing my tools." |
| A step description: "Run grep over _content for loan" | "Look for anything you've lent out" |

## When to switch to technical words

Only on one of three triggers:

1. **They said it first.** If they say "schema", you can too.
2. **They asked how.** "What did you change?" or "which file is it in?" gets
   the files and fields.
3. **The next move is theirs.** When they have to type something, change a
   setting, or pass an error on to someone, give them the exact text. A
   command you will run yourself stays out of the reply.

Many people who own a box are technical and sometimes want the command. The
triggers are how they get it; there is no per-box setting. Plain is not vague:
name the outcome, the count, the date, the person.
