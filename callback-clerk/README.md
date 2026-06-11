# callback-clerk

Chrome extension companion for [callback-box](../callback-box/). Saves pages,
memos, and tab snapshots into a box's inbox via the box-hosted clerk API.

## Quickstart

```bash
pnpm install        # at the monorepo root
cd callback-clerk
pnpm build          # production build to .output/chrome-mv3/
```

Load `.output/chrome-mv3/` unpacked via `chrome://extensions` (enable
Developer mode), or use `pnpm dev` for a live-reloading dev profile.

Built with [WXT](https://wxt.dev/). See `CLAUDE.md` for architecture and
`../callback-box/docs/implemented-plans/refresh-clerk.md` for the design
record of the 2026 refresh.
