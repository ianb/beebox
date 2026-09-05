---
title: "The exhibits contract says the container wraps every tier; the raw-HTML tier gets no container at all"
workstream: chores-burn-down
area: monorepo
resolution: implemented
filed-by: agent
discovered-in: worktree-dev-comments — designing the general browser's exhibit header
labels: [docs, exhibits]
---

**Closed:** This commit scopes the automatic ask-control guarantee to the default and module tiers.

`workstreams-app/docs/exhibits.md` states that the disposition control is
appended below the page's own content *"for every tier, custom pages included"*,
and that a manifest with an ask always gets a control — *"the container's control
is what guarantees there is always some way to reply."*

That is not true of the `index.html` tier. `workstreams-app/src/server/exhibits/app.ts:143-147`
returns early:

```ts
if (resolved.tier === "html") {
  // A vanilla HTML page is a first-class exhibit: served as-is, scripts
  // allowed. That is what this origin exists for.
  const body = await fs.readFile(path.join(resolved.dir, "index.html"), "utf8");
  return reply.type("text/html; charset=utf-8").send(body);
}
```

`renderShell` is never reached, so no container, no ask control. The other two
tiers (default renderer, `index.tsx`) do get it via `app.ts:150-173`.

The early return looks deliberate — serving raw HTML unmodified is the point of
that tier and of the separate origin. So the likely fix is the doc, not the code:
say that the guarantee covers the default and module tiers, and that a raw HTML
exhibit answers its own ask or carries no control.

Worth settling because an agent reading the contract will believe an `index.html`
exhibit with an ask is answerable, and ship one that is not.
