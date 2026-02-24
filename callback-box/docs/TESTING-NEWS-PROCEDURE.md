# Testing the News Procedure

This document describes how to test the news processing procedure from start to finish.

## Prerequisites

- A test box set up (e.g., `~/src/boxes/test1`)
- RSS feeds configured in `config/connectors/`

## Step 1: Pull Fresh News

```bash
cd ~/src/boxes/test1
cb pull
```

This fetches news from all configured connectors (RSS feeds, etc.) and places items in `box/inbox/news/`.

Check status:
```bash
cb status  # Shows inbox count
ls box/inbox/news/  # Lists items
```

## Step 2: Triage

Triage decides which items are worth analyzing. Run in batches:

```bash
cb process-news --triage-only --batch-size 10
```

The agent will:
1. Read the news-guide (if exists) to understand user interests
2. Review each item's title and summary
3. KEEP interesting items in `box/inbox/news/`
4. TRASH uninteresting items to `store/trash/`

Inspect results:
```bash
ls box/inbox/news/  # Items that passed triage
ls store/trash/     # Items that were trashed
```

Repeat until inbox is processed or you're satisfied.

## Step 3: Analyze

Analysis fetches full article content and adds metadata:

```bash
cb process-news --analyze-only --batch-size 5
```

The agent will:
1. Fetch full article content via `cb fetch-news`
2. Add an `<analysis>` element with topics, type, tone, etc.
3. Move analyzed items to `box/pool/news/`

Inspect results:
```bash
ls box/pool/news/  # Analyzed items ready for brief creation
cb show box/pool/news/<item>  # View a specific item's analysis
```

Note: Analysis can hit the 20-turn limit for complex batches. Run again with remaining items if needed.

## Step 4: Create Brief

```bash
cb process-news --edition-only
```

The agent will:
1. Survey all items in the pool
2. Plan a narrative structure
3. Create a brief in `box/output/briefs/`
4. Archive used items to `store/archive/news/`
5. Leave unused items in pool for future briefs

Inspect results:
```bash
ls box/output/briefs/  # New brief
cat box/output/briefs/<date>_<slug>.news-brief.card  # View the brief
ls box/pool/news/  # Items not used (available for next brief)
```

## Step 5: View in Webapp

Start the server:
```bash
cb serve
```

Open http://localhost:3210/news to see the brief with the reading UI.

## Running All Phases

To run the complete pipeline:
```bash
cb process-news  # Runs triage → analyze → brief creation
```

Or with a batch size:
```bash
cb process-news --batch-size 10
```

## Directory Layout Reference

| Location | Purpose |
|----------|---------|
| `box/inbox/news/` | Incoming items awaiting triage |
| `box/inbox/feedback/` | Feedback cards awaiting triage/integration |
| `box/inbox/unhandled/` | Valid input with no clear destination |
| `box/pool/news/` | Analyzed items ready for briefs |
| `box/output/briefs/` | Generated briefs (unread) |
| `store/archive/news/` | Items that have been used in briefs |
| `store/archive/briefs/` | Briefs that have been read (with feedback attrs) |
| `store/integrated/` | Feedback cards absorbed into briefs (kept for provenance) |
| `store/trash/` | Items rejected during triage |
| `config/news-guide.news-guide.card` | User interests, preferences, experiments, reactions |

## Step 6: Read and Provide Feedback

Open the brief in the webapp (http://localhost:3210/news) and read it. As you read:

1. **Thumbs up/down** on individual sections and expandos - click the thumb icons next to headings
2. When done, click **"Done Reading"** at the bottom

The feedback dialog collects:
- **Overall rating**: Great 👍 / OK 👌 / Meh 😐
- **Reactions**: Select applicable options (from guide + brief-specific)

Submit to complete the reading. The brief moves from `box/output/briefs/` to `store/archive/briefs/` with feedback stored as attributes:

```bash
# Check the brief moved
ls box/output/briefs/      # Should be empty (brief moved)
ls store/archive/briefs/   # Should contain the brief

# View the feedback stored on the brief
cat store/archive/briefs/<date>_<slug>.news-brief.card | head -5
```

Feedback attributes on the brief:
- `overall-rating="great|ok|meh"` - User's overall rating
- `read-at="ISO timestamp"` - When feedback was submitted
- `read-reason="user"` - How it was marked read (user action vs expired)
- `selected-reactions="id1,id2"` - Comma-separated reaction IDs (if any)
- `user-feedback="thumbs-up|thumbs-down"` - On section/expando elements

Voice/text comments create separate feedback cards in `box/inbox/feedback/`.

## Step 7: Triage Voice/Text Feedback

Voice recordings need transcription and then triage before processing:

```bash
# First, transcribe any voice recordings (happens during wakeup)
cb wakeup

# Then triage and integrate feedback into briefs
cb triage-feedback
```

The triage agent will:
1. Read each transcribed feedback card
2. Categorize as: **feedback** (about brief), **task** (reminder), or **unhandled**
3. For feedback items: integrate directly into the target brief as `<user-comment>` elements
4. Move processed cards to `store/integrated/` (or `box/inbox/unhandled/` if unclear)

Check results:
```bash
# Feedback cards that were integrated
ls store/integrated/

# Items with unclear intent
ls box/inbox/unhandled/

# View integrated comments in brief
grep user-comment store/archive/briefs/*.card
```

### Split Handling

If a voice recording contains multiple intents (e.g., "This was interesting, I should follow up on Zig later"):
- The feedback portion gets integrated into the brief
- The task portion creates a new card in `box/inbox/unhandled/`

## Step 8: Process Feedback into Guide

Process all accumulated feedback to update the news-guide in a single pass:

```bash
cb process-feedback
```

The agent will:
1. Find all unprocessed briefs (those missing `guide-revision` attr)
2. Extract feedback from each:
   - Overall rating, selected reactions
   - Thumbs up/down on sections/expandos
   - Integrated `<user-comment>` elements
   - What experiments were being tested (from `<curation>`)
3. Synthesize all feedback together
4. Update the guide: interests, preferences, experiments
5. Mark processed briefs with `guide-revision="timestamp"` attr

Check results:
```bash
# View updated guide
cat config/news-guide.news-guide.card

# Check for processed briefs (should have guide-revision attr)
grep guide-revision store/archive/briefs/*.card
```

### Feedback Signal Interpretation

| Signal | Meaning | Guide Update |
|--------|---------|--------------|
| Thumbs up on section | Liked this topic/content | Increase confidence on related interests |
| Thumbs down on section | Disliked this topic/content | Add to disinterests or decrease confidence |
| Overall "great" | Brief matched interests well | Validate current approach |
| Overall "meh" | Brief missed the mark | Review topic selection, consider new experiments |
| Reaction "Missing context" | Expandos need better intros | Update structure preferences |
| Reaction "Topics I don't care about" | Topic mismatch | Review interests/disinterests |
| User comment on section | Explicit explanation | Strong evidence for guide updates |

### Feedback Types

1. **Inline feedback** (stored on brief attrs):
   - Thumbs up/down on sections/expandos (`user-feedback` attr)
   - Overall rating (`overall-rating` attr)
   - Selected reactions (`selected-reactions` attr)

2. **Integrated comments** (stored as `<user-comment>` in brief):
   - Transcribed voice recordings
   - Text comments
   - Attached to specific section/expando as child element

3. **Unhandled items** (in `box/inbox/unhandled/`):
   - Tasks/reminders extracted from feedback
   - Unclear content needing review

## Troubleshooting

**`cb trash` fails with tsconfig error**: The agent may fall back to manual file moves. The end result is the same.

**Agent hits max turns**: Run the phase again with a smaller batch size. Remaining items will be processed.

**Items stuck in inbox after triage**: Some items may not have been processed. Run `--triage-only` again.

**No brief created**: Check that there are items in `box/pool/news/`. The agent needs analyzed items to create a brief.

**Feedback UI not showing**: Make sure the brief is in `box/output/briefs/` (unread). Briefs in `store/archive/briefs/` are already read.

**Voice recordings not transcribed**: Run `cb wakeup` to trigger transcription. Check for `<transcription>` element in feedback cards.

**Feedback not integrated into briefs**: Run `cb triage-feedback` after transcription. Check `store/integrated/` for processed cards.

**Guide not updated after feedback**: Run `cb process-feedback` to process briefs. Check for `guide-revision` attr on archived briefs.
