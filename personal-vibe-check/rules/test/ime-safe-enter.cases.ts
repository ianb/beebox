/**
 * The ime-safe-enter rule's cases, shared with its port in beebox
 * (`beebox/src/core/views/advice/ime-enter.ts`, the `bbx view check` advice
 * for box views, which cannot import this package at runtime). Both
 * implementations run every case, so the two decisions cannot drift.
 * `invalid` cases each report once.
 */

export const imeSafeEnterCases: { valid: string[]; invalid: string[] } = {
  valid: [
    // Guarded with the helper, or with the property directly.
    "<input onKeyDown={(e) => { if (e.key === \"Enter\" && !isComposing(e.nativeEvent)) submit(); }} />",
    "<input onKeyDown={(e) => { if (e.nativeEvent.isComposing) return; if (e.key === \"Enter\") submit(); }} />",
    "<input onKeyDown={(e) => { if (e.keyCode === 229) return; if (e.key === \"Enter\") submit(); }} />",
    "<input onKeyDown={(e) => { if (e.key === \"Process\") return; if (e.key === \"Enter\") submit(); }} />",
    // Activation elements: Enter activates, nothing is composed.
    "<span role=\"button\" onKeyDown={(e) => { if (e.key === \"Enter\") reveal(); }} />",
    "<button onKeyDown={(e) => { if (e.key === \"Enter\") go(); }} />",
    "<a href=\"/x\" onKeyDown={(e) => { if (e.key === \"Enter\") go(); }} />",
    // Enter with a required modifier.
    "<textarea onKeyDown={(e) => { if (e.metaKey && e.key === \"Enter\") send(); }} />",
    // Suppress-only branch.
    "<textarea onKeyDown={(e) => { if (e.key === \"Enter\") e.preventDefault(); }} />",
    "<textarea onKeyDown={(e) => { if (e.key === \"Enter\") { e.preventDefault(); return; } }} />",
    // Not Enter, not a key event, or a handler from another module.
    "<input onKeyDown={(e) => { if (e.key === \"Escape\") close(); }} />",
    "<input onClick={(e) => { if (e.key === \"Enter\") go(); }} />",
    "import { onKey } from \"./k\"; <input onKeyDown={onKey} />",
    // addEventListener on another event type, or guarded.
    "el.addEventListener(\"click\", (e) => { if (e.key === \"Enter\") go(); });",
    "el.addEventListener(\"keydown\", (e) => { if (e.isComposing) return; if (e.key === \"Enter\") go(); });",
    // Dynamic event name is skipped.
    "el.addEventListener(name, (e) => { if (e.key === \"Enter\") go(); });",
    // switch with a guard.
    "<input onKeyDown={(e) => { if (isComposing(e.nativeEvent)) return; switch (e.key) { case \"Enter\": go(); break; } }} />",
    // The guard on an enclosing if.
    "<input onKeyDown={(e) => { if (!e.nativeEvent.isComposing) { if (e.key === \"Enter\") submit(); } }} />",
    // Comparisons with an explicit polarity.
    "<input onKeyDown={(e) => { if (e.isComposing === true) return; if (e.key === \"Enter\") submit(); }} />",
    "<input onKeyDown={(e) => { if (e.key === \"Enter\" && e.isComposing === false) submit(); }} />",
    "<input onKeyDown={(e) => { if (e.key === \"Enter\" && e.keyCode !== 229) submit(); }} />",
    // A bare return or a boolean return is still a suppression.
    "<textarea onKeyDown={(e) => { if (e.key === \"Enter\") { e.preventDefault(); return false; } }} />",
    // An early-return guard whose block does more before returning.
    "<input onKeyDown={(e) => { if (e.isComposing) { log(); return; } if (e.key === \"Enter\") submit(); }} />",
    // An early-return guard that also checks 229.
    "<input onKeyDown={(e) => { if (e.isComposing || e.keyCode === 229) { return; } if (e.key === \"Enter\") submit(); }} />",
  ],
  invalid: [
    "<input onKeyDown={(e) => { if (e.key === \"Enter\") { e.preventDefault(); submit(); } }} />",
    "<input onKeyDown={(event) => { if (event.key === \"Enter\" && matches[0]) choose(matches[0]); }} />",
    "<input onKeyDown={(e) => { if (\"Enter\" === e.key) submit(); }} />",
    "<input onKeyPress={(e) => { if (e.code === \"Enter\") submit(); }} />",
    // A component (TextField) is treated like a text input.
    "<TextField onKeyDown={(e) => { if (e.key === \"Enter\") add(); }} />",
    // Same-file function and const handlers.
    "function onKey(e) { if (e.key === \"Enter\") submit(); }\n<input onKeyDown={onKey} />",
    "const onKey = (e) => { if (e.key === \"Enter\") submit(); };\n<input onKeyDown={onKey} />",
    // A role that does not activate on Enter.
    "<div role=\"textbox\" onKeyDown={(e) => { if (e.key === \"Enter\") submit(); }} />",
    // switch on key.
    "<input onKeyDown={(e) => { switch (e.key) { case \"Enter\": submit(); break; } }} />",
    // addEventListener, inline and by reference.
    "el.addEventListener(\"keydown\", (e) => { if (e.key === \"Enter\") go(); });",
    "const h = function (e) { if (e.key === \"Enter\") go(); };\nwindow.addEventListener(\"keydown\", h);",
    // A negated modifier is not a required modifier.
    "<textarea onKeyDown={(e) => { if (e.key === \"Enter\" && !e.shiftKey) send(); }} />",
    // A composition read that does not control the Enter branch.
    "<input onKeyDown={(e) => { if (e.isComposing) log(); if (e.key === \"Enter\") submit(); }} />",
    "<input onKeyDown={(e) => { if (e.key === \"Enter\") submit(); if (e.isComposing) return; }} />",
    // A returned action is an action, not a suppression.
    "<input onKeyDown={(e) => { if (e.key === \"Enter\") return submit(); }} />",
    // Reversed polarity: these return or act exactly when NOT composing.
    "<input onKeyDown={(e) => { if (e.isComposing === false) return; if (e.key === \"Enter\") submit(); }} />",
    "<input onKeyDown={(e) => { if (e.key === \"Enter\" && e.isComposing !== false) submit(); }} />",
    "<input onKeyDown={(e) => { if (e.keyCode !== 229) return; if (e.key === \"Enter\") submit(); }} />",
    // An early return that needs more than composition leaves Enter unguarded.
    "<input onKeyDown={(e) => { if (e.isComposing && e.shiftKey) return; if (e.key === \"Enter\") submit(); }} />",
    // A non-negated guard in the chain means "only while composing".
    "<input onKeyDown={(e) => { if (e.key === \"Enter\" && e.isComposing) submit(); }} />",
  ],
};
