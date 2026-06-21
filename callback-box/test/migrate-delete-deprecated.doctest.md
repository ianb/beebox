# Migration: delete deprecated schema-less cards

`scripts/migrate/delete-deprecated-cards.ts` hard-deletes the deprecated,
schema-less card types — `news-item`, `news-brief`, and `workflow` — which have
no registered schema and no code that reads them. `isDeprecatedCard(name)` is
the load-bearing selection logic the migration harness drives (the harness then
`unlink`s each match). Importing the module does not run the migration — the CLI
entry is guarded by an `import.meta.url` check.

```ts setup
import { isDeprecatedCard } from "../scripts/migrate/delete-deprecated-cards.js";
```

## The three deprecated types are selected

```ts
[
  isDeprecatedCard("Latest_Headlines.news-item.card"),
  isDeprecatedCard("Weekly_Roundup.news-brief.card"),
  isDeprecatedCard("process-news.workflow.card"),
].join(",")
=> true,true,true
```

## Live card types — and lookalikes — are left alone

```ts
[
  isDeprecatedCard("Note.memo.card"),
  isDeprecatedCard("Soup.recipe.card"),
  isDeprecatedCard("Onboard.procedure.card"),
  isDeprecatedCard("headlines.news-item.md"),
  isDeprecatedCard("workflow.card"),
].join(",")
=> false,false,false,false,false
```
