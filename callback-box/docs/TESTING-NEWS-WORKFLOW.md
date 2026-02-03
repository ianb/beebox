# Testing the News Workflow

This document describes how to test the news processing workflow from start to finish.

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
| `box/pool/news/` | Analyzed items ready for briefs |
| `box/output/briefs/` | Generated briefs (unread) |
| `store/archive/news/` | Items that have been used in briefs |
| `store/archive/briefs/` | Briefs that have been read |
| `store/trash/` | Items rejected during triage |
| `config/news-guide.news-guide.card` | User interests and preferences |

## Troubleshooting

**`cb trash` fails with tsconfig error**: The agent may fall back to manual file moves. The end result is the same.

**Agent hits max turns**: Run the phase again with a smaller batch size. Remaining items will be processed.

**Items stuck in inbox after triage**: Some items may not have been processed. Run `--triage-only` again.

**No brief created**: Check that there are items in `box/pool/news/`. The agent needs analyzed items to create a brief.
