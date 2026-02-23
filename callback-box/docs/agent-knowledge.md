# Agent Knowledge: What It Should Know and How to Test

## Overview

The agent runs inside a box (e.g. `~/src/boxes/test1/`) with Claude Code loading `CLAUDE.md` → `.callback-box/agent-guide.md` plus conditional `.claude/rules/` files. This document defines what we **want** the agent to understand, and `cb prompt` questions to verify it.

## 1. Box Structure and Navigation

**What it should know:**
- Directory layout: `box/inbox/`, `box/jobs/`, `box/output/`, `store/archive/`, `config/`, `tricks/`
- What each directory is for and when cards move between them
- How to find things (Glob patterns for card types)

**Test prompts:**
```
cb prompt "Where would you look for unprocessed incoming items?"
cb prompt "If I wanted to find all memo cards in the system, how would you search?"
cb prompt "What happens to a card after it's processed?"
```

## 2. Card Types and Schemas

**What it should know:**
- Every registered card type (memo, question, workflow, guide, etc.)
- The XML structure of each type
- How to create cards using `cb create -t <template>`
- How to read and modify existing cards

**Test prompts:**
```
cb prompt "What card types do you know about? List them all."
cb prompt "Show me the XML structure of a memo card."
cb prompt "How would you create a new question card asking the user to pick a color?"
cb prompt "What's the difference between a guide card and a workflow card?"
```

## 3. CLI Commands

**What it should know:**
- All `cb` commands and what they do
- When to use `cb move` vs `cb trash`
- How `cb validate` works
- How `cb workflow run` works

**Test prompts:**
```
cb prompt "What cb commands are available to you? List the ones you'd use most."
cb prompt "How do you move a card from inbox to archive?"
cb prompt "How do you validate a card after editing it?"
```

## 4. Workflows

**What it should know:**
- How workflow cards define multi-step processing
- How to run a workflow
- How to author a new workflow
- The XML structure of workflow definitions and workflow runs

**Test prompts:**
```
cb prompt "What workflows are configured in this box?"
cb prompt "How would you create a new workflow that processes bookmark cards?"
cb prompt "Explain the relationship between a workflow card and a workflow-run card."
```

## 5. Guides

**What it should know:**
- What guide cards are and how they influence processing
- How guides get compiled into rules
- How to modify a guide to change agent behavior

**Test prompts:**
```
cb prompt "What guides exist in this box and what do they do?"
cb prompt "If I wanted to change how news items are triaged, what would I modify?"
```

## 6. Tricks (Box-Local Scripts)

**What it should know:**
- What tricks are and where they live
- How to create a new trick
- How `cb trick` runs them

**Test prompts:**
```
cb prompt "What are tricks and how would I create a new one?"
cb prompt "Where do trick scripts live?"
```

## 7. Connectors

**What it should know:**
- What connectors exist and what they do
- How connectors bring data into the box (wakeup) and push data out (finalize)
- How connector config works

**Test prompts:**
```
cb prompt "What connectors are configured for this box?"
cb prompt "How does data get from RSS feeds into the inbox?"
cb prompt "How would outbound notifications work?"
```

## 8. Scheduled Tasks

**What it should know:**
- How scheduled-script cards work
- Where they live
- How `cb tick` and `cb scheduled` use them

**Test prompts:**
```
cb prompt "How do scheduled tasks work in this box?"
cb prompt "How would I add a daily task?"
```

---

## Extending the Box: What CAN the Agent Do?

### Things the agent CAN do today (in-box):
- **Create new workflows** — write XML to `config/workflows/`
- **Modify guides** — edit `config/*.guide.card` to change triage/processing rules
- **Add tricks** — create scripts in `tricks/scripts/`
- **Add scheduled tasks** — create `config/scheduled/*.scheduled-script.card`
- **Create any card** — using `cb create` or writing XML directly

### Things the agent CANNOT do today (require source changes):
- **Add new card types/schemas** — schemas are TypeScript in `callback-box/src/schemas/`, outside the box
- **Add new connectors** — connectors are TypeScript in `callback-box/src/connectors/`, outside the box
- **Add new CLI commands** — commands are in `callback-box/src/cli/commands/`

### Gap: Adding New Card Types

This is the most important gap. Users should be able to say "I want a card type for recipes" and have the agent create it. Options:

**A. Schema-in-box**: Allow card schemas to be defined in the box itself (e.g. `config/schemas/recipe.schema.card` or a YAML/JSON format in `config/schemas/`). The system would load these at runtime alongside the built-in TypeScript schemas.

**B. Agent edits source**: Give the agent access to the callback-box source code too. This works but is messy — the agent would need to understand the build system, registry, etc.

**C. Freeform cards**: Allow cards that don't match a registered schema. The agent can write any XML it wants; validation is relaxed for unknown types. Schemas become optional "enhanced" definitions rather than gatekeepers.

**D. Template-based**: Let schemas be defined as XML templates with validation hints in the box, rather than TypeScript. A simpler declarative format that the agent can create.

### Test Prompts for Extension:
```
cb prompt "I want to track recipes. How would you set that up?"
cb prompt "Can you create a new type of card for tracking project tasks?"
cb prompt "How would you add a new capability to this box?"
```

These prompts will reveal what the agent tries to do — does it look for schema files? Does it try to write raw XML? Does it know it can't add schemas? The answers tell us what documentation and capabilities to add.
