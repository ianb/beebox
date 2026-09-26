# Media

Photos, scans, audio, video, and derived images: how their bytes are kept
without living in git's object store, what an image must look like at rest,
and how a display-sized version is produced. One page per member.

## Members

| Member | What it covers |
|---|---|
| [Assets](media/assets.md) | git-annex: the model, the extension allowlist, absent content, configuration, commands, failure modes, what is not yet there. |
| [Image orientation](media/image-orientation.md) | The invariant that an image at rest is upright with no EXIF orientation, and every ingress path against it. |
| [Image transforms](media/image-transforms.md) | `/api/images/*`: the parameters, the errors, the cache, and the helper views use. |

## Owned elsewhere

- Where a card's media lives and how a ref names it: [card format](cards/format.md#attachments).
- Getting phone photos into a box, for box agents: [phone photos](box/phone-photos.md).
