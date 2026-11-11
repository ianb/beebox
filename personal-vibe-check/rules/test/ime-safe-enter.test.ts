import { RuleTester } from "eslint";
import { describe, it } from "node:test";
import rule from "../ime-safe-enter.ts";

const tester = new RuleTester({
  languageOptions: {
    parserOptions: { ecmaVersion: 2022, sourceType: "module", ecmaFeatures: { jsx: true } },
  },
});

const ERR = [{ messageId: "missingCompositionCheck" }];

describe("ime-safe-enter", () => {
  it("passes and fails the expected handlers", () => {
    tester.run("ime-safe-enter", rule, {
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
        // An early-return guard whose block does more before returning.
        "<input onKeyDown={(e) => { if (e.isComposing) { log(); return; } if (e.key === \"Enter\") submit(); }} />",
        // An early-return guard that also checks 229.
        "<input onKeyDown={(e) => { if (e.isComposing || e.keyCode === 229) { return; } if (e.key === \"Enter\") submit(); }} />",
      ],
      invalid: [
        { code: "<input onKeyDown={(e) => { if (e.key === \"Enter\") { e.preventDefault(); submit(); } }} />", errors: ERR },
        { code: "<input onKeyDown={(event) => { if (event.key === \"Enter\" && matches[0]) choose(matches[0]); }} />", errors: ERR },
        { code: "<input onKeyDown={(e) => { if (\"Enter\" === e.key) submit(); }} />", errors: ERR },
        { code: "<input onKeyPress={(e) => { if (e.code === \"Enter\") submit(); }} />", errors: ERR },
        // A component (TextField) is treated like a text input.
        { code: "<TextField onKeyDown={(e) => { if (e.key === \"Enter\") add(); }} />", errors: ERR },
        // Same-file function and const handlers.
        { code: "function onKey(e) { if (e.key === \"Enter\") submit(); }\n<input onKeyDown={onKey} />", errors: ERR },
        { code: "const onKey = (e) => { if (e.key === \"Enter\") submit(); };\n<input onKeyDown={onKey} />", errors: ERR },
        // A role that does not activate on Enter.
        { code: "<div role=\"textbox\" onKeyDown={(e) => { if (e.key === \"Enter\") submit(); }} />", errors: ERR },
        // switch on key.
        { code: "<input onKeyDown={(e) => { switch (e.key) { case \"Enter\": submit(); break; } }} />", errors: ERR },
        // addEventListener, inline and by reference.
        { code: "el.addEventListener(\"keydown\", (e) => { if (e.key === \"Enter\") go(); });", errors: ERR },
        { code: "const h = function (e) { if (e.key === \"Enter\") go(); };\nwindow.addEventListener(\"keydown\", h);", errors: ERR },
        // A negated modifier is not a required modifier.
        { code: "<textarea onKeyDown={(e) => { if (e.key === \"Enter\" && !e.shiftKey) send(); }} />", errors: ERR },
        // A composition read that does not control the Enter branch.
        { code: "<input onKeyDown={(e) => { if (e.isComposing) log(); if (e.key === \"Enter\") submit(); }} />", errors: ERR },
        { code: "<input onKeyDown={(e) => { if (e.key === \"Enter\") submit(); if (e.isComposing) return; }} />", errors: ERR },
        // A non-negated guard in the chain means "only while composing".
        { code: "<input onKeyDown={(e) => { if (e.key === \"Enter\" && e.isComposing) submit(); }} />", errors: ERR },
      ],
    });
  });
});
