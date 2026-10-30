/**
 * Whether this process is a box unit on a unit host (docs/implemented-plans/per-box-units.md):
 * one Linux user and one systemd unit per box, the box sandboxed and without
 * sudo. The unit's environment file says so (`BBX_UNIT_HOST=1`,
 * `src/hub/box-env-file.ts`); nothing else sets it. What changes on such a
 * host: `bbx host install` records a package instead of installing it, the
 * mobile cookie key derives from the hub secret, and a box's Admin secrets
 * page reaches only the box's own copy of the store.
 */
export function onUnitHost(): boolean {
  return process.env.BBX_UNIT_HOST === "1";
}
