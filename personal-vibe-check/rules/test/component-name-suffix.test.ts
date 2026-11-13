import { RuleTester } from "eslint";
import path from "node:path";
import { describe, it } from "node:test";
import rule from "../component-name-suffix.ts";

const tester = new RuleTester({
  languageOptions: {
    parserOptions: { ecmaVersion: 2022, sourceType: "module", ecmaFeatures: { jsx: true } },
  },
});

interface Options {
  banned: Record<string, string>;
  allowIn?: string[];
}

const DEFAULT: Options = {
  banned: { Modal: "Name it ...Dialog and render ModalDialog.", Popup: "Name it ...Popover or ...Menu." },
  allowIn: ["src/ui/BboxOverlay.tsx"],
};

function file(relative: string): string {
  return path.join(process.cwd(), relative);
}

function valid(code: string, spec?: { options?: Options; filename?: string }): RuleTester.ValidTestCase {
  return { code, options: [spec?.options ?? DEFAULT], filename: file(spec?.filename ?? "src/app/Thing.tsx") };
}

function invalid(code: string, errors: RuleTester.TestCaseError[]): RuleTester.InvalidTestCase {
  return { code, errors, options: [DEFAULT], filename: file("src/app/Thing.tsx") };
}

/** The error for `name`, whose banned suffix is the one `message` belongs to. */
function suffix(name: string, message: string): RuleTester.TestCaseError {
  const end = message === MODAL ? "Modal" : "Popup";
  return { messageId: "suffix", data: { name, suffix: end, message } };
}

const MODAL = "Name it ...Dialog and render ModalDialog.";
const POPUP = "Name it ...Popover or ...Menu.";

void describe("component-name-suffix", () => {
  void it("passes names without a banned suffix, lower-case names and non-component values", () => {
    tester.run("component-name-suffix", rule, {
      valid: [
        valid("function SettingsDialog() { return null; }"),
        valid("const ShareMenu = () => null;"),
        valid("function openModal() {}"),
        valid("const useModal = () => null;"),
        valid("const ModalStore = createStore();"),
        valid("const DEFAULT_MODAL = 1;"),
        valid("class ThingModal {}"),
      ],
      invalid: [],
    });
  });

  void it("reports a function declaration, arrow, function expression, memo and forwardRef", () => {
    tester.run("component-name-suffix", rule, {
      valid: [],
      invalid: [
        invalid("function ThingModal() { return null; }", [suffix("ThingModal", MODAL)]),
        invalid("export const ThingPopup = () => null;", [suffix("ThingPopup", POPUP)]),
        invalid("const ThingPopup = function () { return null; };", [suffix("ThingPopup", POPUP)]),
        invalid("const ThingModal = memo(() => null);", [suffix("ThingModal", MODAL)]),
        invalid("const ThingModal = React.forwardRef(() => null);", [suffix("ThingModal", MODAL)]),
        invalid("function Modal() { return null; }", [suffix("Modal", MODAL)]),
      ],
    });
  });

  void it("reports each bad name in a file with good ones", () => {
    tester.run("component-name-suffix", rule, {
      valid: [],
      invalid: [
        invalid("function Good() { return null; }\nfunction BadPopup() { return null; }\nconst AlsoModal = () => null;", [
          suffix("BadPopup", POPUP),
          suffix("AlsoModal", MODAL),
        ]),
      ],
    });
  });

  void it("skips files in allowIn, and does nothing with no banned suffixes", () => {
    tester.run("component-name-suffix", rule, {
      valid: [
        valid("function BboxModal() { return null; }", { filename: "src/ui/BboxOverlay.tsx" }),
        valid("function ThingModal() { return null; }", { options: { banned: {} } }),
      ],
      invalid: [],
    });
  });

  void it("skips names it cannot read: destructuring and anonymous defaults", () => {
    tester.run("component-name-suffix", rule, {
      valid: [valid("const { ThingModal } = parts;"), valid("export default function () { return null; }")],
      invalid: [],
    });
  });
});
