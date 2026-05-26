# callback-clerk

> **Status: dormant, currently does not build.**
>
> `package.json` depends on `callback-dropbox` (file:`../callback-dropbox`),
> a sibling Cloudflare Worker package that was deleted. Three source files
> still import from it:
>
> - `src/popup/PairingView.tsx` — `redeemPairingCode` from `callback-dropbox/client`
> - `src/lib/dropbox.ts` — `DropboxClient` from `callback-dropbox/client`
> - `src/background/index.ts` — uses `createDropboxClient()` at 5 call sites
>
> `pnpm install` fails until this is resolved. To revive callback-clerk,
> either restore the `callback-dropbox` client library (the Worker URL
> `callback-dropbox.ianbicking.workers.dev` is hardcoded in PairingView.tsx),
> inline the two exported functions, or retire callback-clerk entirely.

@CONVENTIONS.md
