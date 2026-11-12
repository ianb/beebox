// ⚠️ DO NOT disable or turn "off" any lint rule here without very clear and
// explicit permission from the user. Every rule in personal-vibe-check is a
// deliberate choice. Silently disabling a rule to dodge violations is how this
// config drifted out of sync with our own style. If a rule is genuinely wrong,
// raise it — don't quietly switch it off. Burn down debt rule-by-rule instead.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { vibeCheck } from "@ianbicking/personal-vibe-check/eslint";
import tapCheck from "@ianbicking/tap-check/eslint";

// --- Frontend import-boundary contract (project-local; see
// docs/implemented-plans/clerk-contract-and-import-boundary.md Track 2, and the paths
// comment in tsconfig.json). The frontend must not import backend source by a
// raw relative path that escapes src/frontend/: type imports go through the
// @core/@schemas/@backend type-only aliases; value imports go through @shared
// (relocate the value into src/shared/ if it isn't there yet). This is a
// spelling-based ban (no-restricted-imports patterns) — NOT
// import-x/no-restricted-paths, which silently skips imports its resolver
// can't resolve; with this repo's broken frontend ts-resolver an alias import
// would pass by accident, not design. The raw spellings are banned; the alias
// spellings are legal, which is honest about intent. (The `lib` ban below is
// the one exception, by resolved path — see its own comment for why the
// broken-resolver concern doesn't apply there.)
// Backend source directories that DO NOT exist as frontend subdirs, so any raw
// relative path with the segment (at any climb-out depth) is an escape. The
// alias `@core/…` etc. is a distinct segment (`@core` ≠ `core`) and stays legal.
const BOUNDARY_BAN_MESSAGE =
  "Don't import backend source by a raw relative path that escapes src/frontend/. Use the @core/@schemas/@backend type-only aliases for TYPES; for a VALUE, relocate it into src/shared/ and import via @shared. (tsconfig.json paths + this file are the boundary contract.)";
const BOUNDARY_PATTERNS = [
  {
    group: [
      "**/core/**",
      "**/webapp/**",
      "**/schemas/**",
      "**/services/**",
      "**/cards/**",
      "**/scenario/**",
    ],
    message: BOUNDARY_BAN_MESSAGE,
  },
  {
    // The @core/@schemas/@backend aliases are TYPE-ONLY (deliberately unaliased
    // in vite.config.ts). Ban VALUE imports through them — `allowTypeImports`
    // keeps `import type …` legal. Without this, a value import through the
    // alias passes lint AND resolves under tsx (which runs with the frontend
    // tsconfig, honoring these paths — verified 2026-07-12), so it would execute
    // a backend graph in a tsx path even though the Vite client build rejects
    // it. Needs @typescript-eslint/no-restricted-
    // imports (the base ESLint rule has no `allowTypeImports`).
    group: ["@core/**", "@backend/**"],
    allowTypeImports: true,
    message:
      "@core/@backend are TYPE-ONLY aliases (no Vite alias). Import only types (`import type …`). A value import executes under tsx and pulls backend source into that graph — relocate the value into src/shared/ and import via @shared.",
  },
  {
    // @schemas is type-only too, with ONE exception: a card type's list
    // component, `@schemas/<type>.list-entry`. That file is frontend code
    // living beside its schema (boxholder decision, 2026-09-20);
    // vite.config.ts aliases exactly that spelling, and ../../eslint.config.ts
    // fences what such a file may import in turn. Written as a `regex` rather
    // than a negated `group` pattern because a `!` entry in `group` does not
    // exclude a match (probed 2026-09-20).
    regex: String.raw`^@schemas/(?!.*\.list-entry$).`,
    allowTypeImports: true,
    message:
      "@schemas is a TYPE-ONLY alias (no Vite alias) apart from `@schemas/<type>.list-entry`. Import only types (`import type …`). A value import executes under tsx and pulls backend source into that graph — relocate the value into src/shared/ and import via @shared.",
  },
];
// src/shared/ is bundler-safe, so a raw `../shared/…` bundles nothing harmful —
// but the convention is the @shared alias. Banned raw EXCEPT for modules that
// run OUTSIDE Vite where @shared can't resolve: the tap/tsx test runner uses
// the ROOT tsconfig (no @shared path), and the view-widgets esbuild bundle
// externalizes packages and can't resolve the alias.
// Those files — proven by the 2026-07-12 probe — must import shared by raw
// relative path and are exempted from THIS pattern below (they still carry the
// core/webapp/… ban).
// --- Backend src/lib/ ban, by RESOLVED PATH (not by counting `../`). The
// frontend has its own src/lib/ (beebox/src/frontend/src/lib/), a distinct
// directory from the backend's beebox/src/lib/ — a spelling-based
// `../../../lib/**` group can't tell them apart except by climb-out depth,
// which breaks every time a component moves a directory level (as happened
// 2026-09-27: see git history on this file). import-x/no-restricted-paths
// resolves each import specifier to an absolute file path and compares that to
// the zone's `from` directory, so it's exact at any depth and any relative
// spelling (`../../lib/x`, `../../../x/../lib/y`, etc. all resolve the same).
// This sidesteps the broken-resolver concern in the file-level comment above:
// that concern is about the TS-path-alias resolver failing to resolve
// `@core/…`-style specifiers; a plain relative `../lib/x` resolves through the
// plain node resolver (configured below), which has no alias step to break.
const FRONTEND_ROOT = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_SRC_DIR = path.join(FRONTEND_ROOT, "src");
const BACKEND_LIB_DIR = path.join(FRONTEND_ROOT, "..", "lib");
const BACKEND_LIB_BAN_MESSAGE =
  "Don't import the backend src/lib/ from the frontend. Move the helper into src/shared/ and import via @shared (the frontend's own src/lib/ is a different directory and is never matched by this resolved-path ban).";

const SHARED_ALIAS_PATTERN = {
  group: ["**/shared/**"],
  message:
    "Import shared modules via the @shared/* alias, not a raw relative path. (Raw relative is reserved for the few modules that run outside Vite — tests and the view-widgets bundle — where @shared can't resolve; those are exempted in eslint.config.ts.)",
};
// Modules exercised outside the Vite bundler that legitimately import src/shared/
// by raw relative path (@shared unresolvable there — see SHARED_ALIAS_PATTERN).
const OUTSIDE_VITE_SHARED_RAW = [
  "src/components/chat/conversation/controller-pool/pool.ts",
  "src/components/chat/conversation/controller-pool/start-records.ts",
  "src/lib/view-url.ts",
  "src/lib/audio/speech-parsing/parseTags.ts",
  "src/lib/structured-output-parsing.ts",
  "src/lib/audio/speech-parsing/parse.ts",
  "src/machines/chatMachine/chat-shared.ts",
  "src/exports/view-widgets.tsx",
  // Transitively loaded by the tap/tsx test runner via input/emission +
  // input/voice-intent (root tsconfig, no @shared resolution).
  "src/components/chat/InteractiveChat-helpers.ts",
  // Loaded outside Vite by their own tests (root tsconfig, no @shared
  // resolution): each imports @shared/is-record by raw relative path.
  "src/input/emission-persist.ts",
  "src/lib/dictation-draft.ts",
  "src/lib/figure-params.ts",
  "src/lib/location-share.ts",
  "src/components/chat/everywhere/InteractiveChat/native-emission.ts",
  "src/machines/chatMachine/chat-actors.ts",
  // Loaded outside Vite by its own test (root tsconfig, no @shared
  // resolution): imports @shared/todo-model by raw relative path.
  "src/components/todo-view-card-logic.ts",
  // Loaded outside Vite by its own test (root tsconfig, no @shared
  // resolution): imports @shared/invariant by raw relative path.
  "src/components/history/HistoryViewCard/CommitDetail-diff.ts",
  // Loaded outside Vite by its own test (root tsconfig, no @shared
  // resolution): imports @shared/result by raw relative path.
  "src/lib/ui-scan/resolve.ts",
];

// Dismissal (outside press, Escape) belongs to the anchored layer, so every
// anchored panel is a Menu or a Popover. Only ui/AnchoredLayer.tsx imports it.
const DISMISS_PATTERN = {
  group: ["**/hooks/useDismiss"],
  message: "An anchored panel is <Popover> or <Menu> (components/ui); only ui/AnchoredLayer.tsx uses useDismiss.",
};

// A modal is <ModalDialog>; only ui/ModalDialog.tsx calls useModalDialog.
const MODAL_DIALOG_PATTERN = {
  group: ["**/hooks/useModalDialog"],
  message: "A modal is <ModalDialog> (components/ui/ModalDialog); only it uses useModalDialog.",
};

// Files that draw a viewport-fixed layer (`fixed`, inline `position: fixed`),
// one per line with the reason. Exempt from that entry only.
const VIEWPORT_LAYER_OWNERS = [
  // The primitives.
  "src/components/ui/AnchoredLayer.tsx",
  "src/components/ui/ModalDialog.tsx",
  "src/components/ui/ControlRing.tsx",
  "src/components/ui/ToastViewport.tsx",
  // The full-screen camera surface, not a layer over the app: a modal would hold every toast.
  "src/components/capture/CaptureScreen/view.tsx",
  // A dock at the bottom of the screen.
  "src/components/DebugLog.tsx",
  // Draws over the whole app by design.
  "src/components/SourceInspector.tsx",
  // The theme studio's floating controls.
  "src/pages/dev/components/ThemeStudioHarness/controls.tsx",
];
const VIEWPORT_LAYER_MESSAGE =
  "A viewport layer is a ui/ primitive: ModalDialog, Popover, Menu, AnchoredLayer, ControlRing, ToastViewport.";

export default [
  // `test` in roots (boxholder decision, 2026-10-16): test/ is held to the same
  // reviewed ruleset as src/, matching ../../eslint.config.ts. Outside the
  // roots, files get none of the reviewed ruleset (they once fell through to an
  // unreviewed base with bans that are not house style: `??`, inline unions, fs-filename).
  ...vibeCheck({ react: true, roots: ["src", "test"] }),
  // Base import-boundary ban: every frontend source file. no-restricted-imports
  // does NOT merge across flat configs (last match wins), so any later block
  // that sets this rule must restate every pattern it still wants — see the
  // outside-Vite block below, which drops SHARED_ALIAS_PATTERN deliberately.
  // Uses @typescript-eslint/no-restricted-imports (for `allowTypeImports` on the
  // alias-value ban); the base rule is turned off here so the two don't
  // double-report on these files.
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": "off",
      "@typescript-eslint/no-restricted-imports": [
        "error",
        { patterns: [...BOUNDARY_PATTERNS, SHARED_ALIAS_PATTERN, DISMISS_PATTERN, MODAL_DIALOG_PATTERN] },
      ],
    },
  },
  // Outside-Vite modules: full boundary ban MINUS the @shared-alias rule (they
  // must import src/shared/ by raw relative path — @shared can't resolve there).
  {
    files: OUTSIDE_VITE_SHARED_RAW,
    rules: {
      "no-restricted-imports": "off",
      "@typescript-eslint/no-restricted-imports": ["error", { patterns: [...BOUNDARY_PATTERNS, DISMISS_PATTERN, MODAL_DIALOG_PATTERN] }],
    },
  },
  // The one owner of useDismiss: the base patterns without DISMISS_PATTERN.
  {
    files: ["src/components/ui/AnchoredLayer.tsx"],
    rules: {
      "no-restricted-imports": "off",
      "@typescript-eslint/no-restricted-imports": ["error", { patterns: [...BOUNDARY_PATTERNS, SHARED_ALIAS_PATTERN, MODAL_DIALOG_PATTERN] }],
    },
  },
  // The one owner of useModalDialog: the base patterns without MODAL_DIALOG_PATTERN.
  {
    files: ["src/components/ui/ModalDialog.tsx"],
    rules: {
      "no-restricted-imports": "off",
      "@typescript-eslint/no-restricted-imports": ["error", { patterns: [...BOUNDARY_PATTERNS, SHARED_ALIAS_PATTERN, DISMISS_PATTERN] }],
    },
  },
  // Backend src/lib/ ban by resolved path — see BACKEND_LIB_DIR comment above.
  // Applies to every frontend file (including OUTSIDE_VITE_SHARED_RAW, which
  // is a subset of this glob), independent of the spelling-based patterns
  // above. The node resolver is configured with TS extensions so `../lib/x`
  // (no extension, .ts on disk) actually resolves instead of being silently
  // skipped as unresolvable.
  {
    files: ["src/**/*.{ts,tsx}"],
    settings: {
      "import-x/resolver": {
        node: { extensions: [".ts", ".tsx", ".js", ".jsx", ".json"] },
      },
    },
    rules: {
      "import-x/no-restricted-paths": [
        "error",
        {
          zones: [
            {
              target: FRONTEND_SRC_DIR,
              from: BACKEND_LIB_DIR,
              message: BACKEND_LIB_BAN_MESSAGE,
            },
          ],
        },
      ],
    },
  },
  {
    rules: {
      "max-params": ["error", 2],
      // react-hooks v7 added this rule. The codebase has several legitimate
      // setState-in-effect call sites (transcription buffering, route param
      // resets, etc.) that are flagged but not actually wrong for our usage.
      // Disable until/unless we do a real audit.
      "react-hooks/set-state-in-effect": "off",
      // Check the SSR-safe layout effect's dependency list like useLayoutEffect's.
      "react-hooks/exhaustive-deps": ["error", { additionalHooks: "^useIsomorphicLayoutEffect$" }],
    },
  },
  // Outside any components/ subdirectory: every JSX element's className must
  // be outer-layout classes only (margin, padding, flex/grid item, sizing,
  // position). Keeps page-level code (renderers, app-shell, routes) from
  // smuggling appearance in via <div className="bg-plum shadow">. Files
  // inside components/ are exempt — that is where appearance lives.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["**/components/**"],
    rules: {
      "personal-vibe-check/restrict-component-classes": ["error", { matchAll: true }],
    },
  },
  // 100vh overshoots on mobile Safari: use the dvh forms. Opt-in rule (Tailwind-specific).
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: { "personal-vibe-check/no-viewport-height-class": "error" },
  },
  // Pixel font sizes ignore the browser's default font size: write rem. Opt-in rule (Tailwind-specific).
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: { "personal-vibe-check/no-px-font-size-class": "error" },
  },
  // One owner per visual shape: a copy of a primitive's classes elsewhere is
  // a duplicate. Each entry lists the files that own the shape (`allowIn`,
  // relative to this config); docs/plans/ui-primitives-dedup.md adds the rest.
  {
    files: ["src/**/*.tsx"],
    rules: {
      "personal-vibe-check/restricted-classes": [
        "error",
        {
          entries: [
            {
              all: ["animate-spin"],
              allowIn: ["src/components/ui/Spinner.tsx"],
              message: "Use <Spinner> from components/ui/Spinner.",
            },
            {
              // The edge positions only: `*-full` would also match `rounded-full`.
              all: ["absolute", "top-full|bottom-full|left-full|right-full", "z-*"],
              allowIn: ["src/components/ui/AnchoredLayer.tsx"],
              message: "An anchored panel is <Popover> or <Menu>.",
            },
            {
              // Removing the outline needs a focus style in its place; `hover:` and bare `ring-*` do not count.
              all: ["outline-none|focus:outline-none|focus-visible:outline-none"],
              none: [
                "focus:ring-*|focus-visible:ring-*|focus-within:ring-*",
                "focus:border-*|focus-visible:border-*",
                "focus:shadow-*|focus-visible:shadow-*",
                "focus:outline-*!focus:outline-none|focus-visible:outline-*!focus-visible:outline-none",
              ],
              message: "outline-none removes the keyboard focus ring: add focus-visible:ring-*, a border, shadow or outline.",
            },
            { all: ["fixed"], allowIn: VIEWPORT_LAYER_OWNERS, message: VIEWPORT_LAYER_MESSAGE },
          ],
          stylePosition: { values: ["fixed"], allowIn: VIEWPORT_LAYER_OWNERS, message: VIEWPORT_LAYER_MESSAGE },
        },
      ],
    },
  },
  // One owner per time format: FriendlyDate and friendlyDate own the browser's
  // date and time text. The deploy page is a separate script with no React
  // and no Temporal polyfill, so it keeps its call.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/components/ui/FriendlyDate.tsx", "src/deploy-page/**"],
    rules: {
      "no-restricted-properties": [
        "error",
        ...["toLocaleTimeString", "toLocaleDateString"].map((property) => ({
          property,
          message: "Use friendlyDate(value, mode) or <FriendlyDate> from components/ui/FriendlyDate.",
        })),
      ],
    },
  },
  // One owner per control: a raw <input>, <textarea> or <select> skips the
  // field primitives' label, error and ink; a raw list or table skips List's
  // role and Table's name and scroll container; a hand-written menu role or
  // aria-haspopup skips Menu's keys and dismissal. Markdown bodies are Markdoc
  // output, not JSX, so this does not see them. Each tag lists the files that
  // render it (`allowIn`, relative to this config), one file per line with the
  // reason; a new file in ui/fields/ is not exempt until it is listed here.
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "personal-vibe-check/require-ui-primitive": [
        "error",
        {
          elements: {
            input: {
              allowIn: [
                // TextField and NumberField.
                "src/components/ui/fields/field.tsx",
                // CheckboxField and Checkbox.
                "src/components/ui/fields/checkbox.tsx",
                // RadioGroup's radios.
                "src/components/ui/fields/radio.tsx",
                // useFilePicker's hidden file input.
                "src/components/ui/fields/file-picker.tsx",
                // A visible file input: a browser-automation tool sets files on it (see its header).
                "src/components/browser-task/SubmissionForm.tsx",
              ],
              message:
                "Use TextField, NumberField, CheckboxField, Checkbox, RadioGroup or useFilePicker (components/ui/fields).",
            },
            textarea: {
              allowIn: [
                // TextareaField.
                "src/components/ui/fields/field.tsx",
                // The chat composer's textarea: autosize, caret tracking, IME-safe Enter.
                "src/components/chat/InteractiveChat-composer/ComposerTextarea.tsx",
              ],
              message: "Use TextareaField (components/ui/fields/field).",
            },
            select: {
              allowIn: [
                // SelectField.
                "src/components/ui/fields/field.tsx",
              ],
              message: "Use SelectField (components/ui/fields/field); tone=\"dark\" on the capture screen.",
            },
            ul: {
              allowIn: [
                // List: marker, gap, direction, divided, and role="list" when unmarked.
                "src/components/ui/List.tsx",
              ],
              message: "Use List (components/ui/List) with raw <li> children.",
            },
            ol: {
              allowIn: [
                // List with marker="decimal" or ordered.
                "src/components/ui/List.tsx",
              ],
              message: "Use List marker=\"decimal\" or List ordered (components/ui/List).",
            },
            table: {
              allowIn: [
                // Table: the required name and the one scroll container.
                "src/components/ui/Table.tsx",
              ],
              message: "Use Table (components/ui/Table): caption or labelledBy; variant=\"grid\" for document content.",
            },
            th: {
              allowIn: [
                // Th: required scope, variant classes.
                "src/components/ui/Table.tsx",
              ],
              message: "Use Th (components/ui/Table) with scope=\"col\" or \"row\".",
            },
            td: {
              allowIn: [
                // Td: variant classes, forwarded cell attributes.
                "src/components/ui/Table.tsx",
              ],
              message: "Use Td (components/ui/Table).",
            },
            dialog: {
              allowIn: [
                // ModalDialog: showModal(), focus return, toast hold, Escape layer.
                "src/components/ui/ModalDialog.tsx",
                // Popover: a non-modal <dialog popover="manual">.
                "src/components/ui/Popover.tsx",
              ],
              message: "Use ModalDialog (a modal) or Popover (an anchored panel) from components/ui.",
            },
          },
          roles: Object.fromEntries(
            ["menu", "menuitem", "menuitemcheckbox", "menuitemradio"].map((role) => [role, {
              allowIn: [
                // Menu: the panel's role="menu".
                "src/components/ui/Menu.tsx",
                // MenuItem: rows and their sibling action.
                "src/components/ui/menu-item.tsx",
              ],
              message: "Use Menu and MenuItem (components/ui/Menu, components/ui/menu-item); a row's second button is MenuItem action.",
            }]),
          ),
          attributes: {
            "aria-haspopup": {
              allowIn: [
                // The trigger props of Menu and Popover.
                "src/components/ui/Menu.tsx",
                "src/components/ui/Popover.tsx",
              ],
              message: "Spread the trigger props of Menu or Popover (ariaProps).",
            },
          },
        },
      ],
    },
  },
  // One word per overlay kind: a component named ...Modal or ...Popup reads as
  // a second kind of overlay. Names only; the element, role, class and import
  // rules above check what a component renders.
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "personal-vibe-check/component-name-suffix": [
        "error",
        {
          banned: {
            Popup: "Name it ...Popover (a <Popover>) or ...Menu (a <Menu>).",
            Overlay: "Name it ...Dialog (a <ModalDialog>), ...Popover or ...Screen.",
            Modal: "Name it ...Dialog and render <ModalDialog>.",
            Sheet: "Name it ...Dialog (a <ModalDialog>) or ...Popover.",
            Tooltip: "Name it ...Popover (a <Popover>), or use a title attribute.",
          },
          // A box drawn over an image: the one meaning "Overlay" keeps.
          allowIn: ["src/components/ui/BboxOverlay.tsx"],
        },
      ],
    },
  },
  {
    // Same options as the preset, plus an allowance for TanStack Router's
    // `throw redirect(...)` pattern — the router catches thrown Redirects
    // (router.tsx route guards).
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/only-throw-error": [
        "error",
        {
          allowRethrowing: true,
          allowThrowingAny: false,
          allowThrowingUnknown: false,
          allow: [{ from: "package", name: "Redirect", package: "@tanstack/router-core" }],
        },
      ],
    },
  },
  {
    // Tests compare whole values with t.check (../../docs/testing/check.md),
    // as in ../../eslint.config.ts. tap-check resolves from beebox's
    // node_modules, as it does for these tests' tap preloads; declaring it
    // here would make pnpm install a second set of its tap peers.
    files: ["test/**/*.{ts,tsx}"],
    plugins: { "tap-check": tapCheck },
    rules: {
      "tap-check/check-whole-value": "error",
      "tap-check/no-voided-check": "error",
      "tap-check/no-tap-assert": "error",
      // Find controls by id or role + accessible name (docs/testing/check.md, "DOM tests").
      "tap-check/no-text-locator": "error",
    },
  },
];
