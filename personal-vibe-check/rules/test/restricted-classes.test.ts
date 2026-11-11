import { RuleTester } from "eslint";
import path from "node:path";
import { describe, it } from "node:test";
import rule from "../restricted-classes.ts";

const tester = new RuleTester({
  languageOptions: {
    parserOptions: { ecmaVersion: 2022, sourceType: "module", ecmaFeatures: { jsx: true } },
  },
});

interface Entry {
  all: string[];
  none?: string[];
  allowIn?: string[];
  message: string;
}

interface Options {
  entries: Entry[];
  callees?: string[];
  stylePosition?: { values: string[]; allowIn?: string[]; message: string };
}

const SPIN: Entry = {
  all: ["animate-spin"],
  allowIn: ["src/ui/Spinner.tsx"],
  message: "Use <Spinner>.",
};
const FIXED_Z: Entry = { all: ["fixed", "z-*"], message: "Use a layer primitive." };
const ANCHORED: Entry = { all: ["absolute", "top-full", "z-*"], message: "Use <Popover>." };
const FIXED_ONLY: Entry = { all: ["fixed"], none: ["static"], message: "No fixed." };
const OUTLINE: Entry = {
  all: ["outline-none|focus:outline-none"],
  none: [
    "focus:ring-*|focus-visible:ring-*|focus:border-*|focus-visible:border-*",
    "focus:outline-*!focus:outline-none|focus-visible:outline-*!focus-visible:outline-none",
  ],
  message: "Replace the focus outline.",
};
const POSITION = {
  values: ["fixed"],
  allowIn: ["src/ui/Layer.tsx"],
  message: "Use a layer primitive.",
};

const DEFAULT: Options = { entries: [SPIN] };

/** A file path under ESLint's working directory, as RuleTester runs it. */
function file(relative: string): string {
  return path.join(process.cwd(), relative);
}

function valid(code: string, options?: Options): RuleTester.ValidTestCase {
  return { code, options: [options ?? DEFAULT], filename: file("src/app/Thing.tsx") };
}

function classes(found: string, message: string): RuleTester.TestCaseError {
  return { messageId: "restrictedClasses", data: { classes: found, message } };
}

function position(value: string, message: string): RuleTester.TestCaseError {
  return { messageId: "restrictedPosition", data: { value, message } };
}

function invalid(
  code: string,
  spec: { errors: RuleTester.TestCaseError[]; options?: Options },
): RuleTester.InvalidTestCase {
  return {
    code,
    errors: spec.errors,
    options: [spec.options ?? DEFAULT],
    filename: file("src/app/Thing.tsx"),
  };
}

const spinError = classes("animate-spin", "Use <Spinner>.");

describe("restricted-classes: reading class values", () => {
  it("reads className strings, templates, branches and class helpers", () => {
    tester.run("restricted-classes", rule, {
      valid: [
        // No-op: the pattern is absent.
        valid('<div className="w-4 h-4 animate-pulse" />'),
        // Not a className.
        valid('<div title="animate-spin" />'),
        // A dynamic identifier or member expression is skipped.
        valid("<div className={classes} />"),
        valid("<div className={styles.spin} />"),
        // A call to something that is not a class helper is skipped.
        valid('<div className={pick("animate-spin")} />'),
        // A template token that touches a ${} boundary is partial.
        valid("<div className={`animate-sp${a}in`} />"),
        // Arrays and objects outside a class helper are not class sources.
        valid('const parts = ["animate-spin"]; const flags = { "animate-spin": on };'),
      ],
      invalid: [
        invalid('<div className="w-4 animate-spin" />', { errors: [spinError] }),
        invalid('<div className={"animate-spin"} />', { errors: [spinError] }),
        invalid("<div className={`animate-spin ${a}`} />", { errors: [spinError] }),
        invalid('<div className={on ? "animate-spin" : "p-2"} />', { errors: [spinError] }),
        invalid('<div className={on && "animate-spin"} />', { errors: [spinError] }),
        invalid('<div className={cls ?? "animate-spin"} />', { errors: [spinError] }),
        invalid('<div className={cn("w-4", x, "animate-spin")} />', { errors: [spinError] }),
        invalid('<div className={clsx({ "animate-spin": busy })} />', { errors: [spinError] }),
        invalid('<div className={twMerge(["w-4", ["animate-spin"]])} />', { errors: [spinError] }),
        invalid('<div className={`p-2 ${cn(on && "animate-spin")}`} />', { errors: [spinError] }),
        // A class helper outside a className attribute is a source on its own.
        invalid('const classes = cn("w-4", "animate-spin");', { errors: [spinError] }),
        // Variants: md: is ignored, other variants must be listed.
        invalid('<div className="md:animate-spin" />', {
          errors: [classes("md:animate-spin", SPIN.message)],
        }),
        // Many unrelated optional classes beside one banned token: one finding.
        invalid(
          '<div className={cn("animate-spin", a && "p-1", b && "p-2", c && "p-3", d && "p-4", e && "p-5", f && "p-6")} />',
          { errors: [spinError] },
        ),
      ],
    });
  });

  it("does not report a helper call twice", () => {
    tester.run("restricted-classes", rule, {
      valid: [],
      invalid: [
        invalid('<div className={cn(on && cn("animate-spin"))} />', { errors: [spinError] }),
      ],
    });
  });

  it("skips a variant the pattern does not list", () => {
    tester.run("restricted-classes", rule, {
      valid: [valid('<div className="hover:animate-spin" />')],
      invalid: [],
    });
  });

  it("matches combinations per conditional operand", () => {
    tester.run("restricted-classes", rule, {
      valid: [
        valid('<div className={clsx(a && "absolute top-full", !a && "z-50")} />', {
          entries: [ANCHORED],
        }),
        // Documented miss: the combination is split across two independent operands.
        valid('<div className={clsx(a && "absolute", b && "top-full z-50")} />', {
          entries: [ANCHORED],
        }),
        valid('<div className={cn("fixed static")} />', { entries: [FIXED_ONLY] }),
        valid('<div className={cn("static", a && "fixed")} />', { entries: [FIXED_ONLY] }),
        // A template split mid-token does not match.
        valid("<div className={`fix${a}ed z-10`} />", { entries: [FIXED_Z] }),
      ],
      invalid: [
        invalid('<div className={cn("z-10", a ? "fixed" : "absolute")} />', {
          errors: [classes("fixed z-10", FIXED_Z.message)],
          options: {
            entries: [FIXED_Z],
          },
        }),
        invalid('<div className={cn("fixed", x)} />', {
          errors: [classes("fixed", FIXED_ONLY.message)],
          options: { entries: [FIXED_ONLY] },
        }),
        invalid("<div className={clsx({ fixed: open })} />", {
          errors: [classes("fixed", FIXED_ONLY.message)],
          options: {
            entries: [FIXED_ONLY],
          },
        }),
        invalid("<div className={`fixed ${a}`} />", {
          errors: [classes("fixed", FIXED_ONLY.message)],
          options: { entries: [FIXED_ONLY] },
        }),
        // twMerge would render `static`; the matcher does not simulate the merge.
        invalid('<div className={cn("fixed", "static")} />', {
          errors: [classes("fixed", FIXED_ONLY.message)],
          options: {
            entries: [FIXED_Z, { all: ["fixed"], message: FIXED_ONLY.message }],
          },
        }),
      ],
    });
  });
});

describe("restricted-classes: entries and options", () => {
  it("requires the replacement for an outline removal", () => {
    tester.run("restricted-classes", rule, {
      valid: [
        valid('<button className="focus:outline-none focus-visible:ring-2" />', {
          entries: [OUTLINE],
        }),
        valid('<button className="outline-none md:focus-visible:ring-2" />', {
          entries: [OUTLINE],
        }),
        valid('<button className="outline-none focus:border-accent" />', { entries: [OUTLINE] }),
      ],
      invalid: [
        invalid('<button className="outline-none hover:ring-2" />', {
          errors: [classes("outline-none", OUTLINE.message)],
          options: {
            entries: [OUTLINE],
          },
        }),
        invalid('<button className="focus:outline-none" />', {
          errors: [classes("focus:outline-none", OUTLINE.message)],
          options: {
            entries: [OUTLINE],
          },
        }),
        invalid('<button className="focus:outline-none focus:outline-none" />', {
          errors: [classes("focus:outline-none", OUTLINE.message)],
          options: { entries: [OUTLINE] },
        }),
      ],
    });
  });

  it("exempts the owning files listed in allowIn", () => {
    tester.run("restricted-classes", rule, {
      valid: [
        {
          code: '<svg className="animate-spin" />',
          options: [DEFAULT],
          filename: file("src/ui/Spinner.tsx"),
        },
        {
          code: '<div style={{ position: "fixed" }} />',
          options: [{ entries: [], stylePosition: POSITION }],
          filename: file("src/ui/Layer.tsx"),
        },
      ],
      invalid: [
        // Another file in the same directory is not exempt.
        {
          code: '<svg className="animate-spin" />',
          errors: [spinError],
          options: [DEFAULT],
          filename: file("src/ui/Button.tsx"),
        },
      ],
    });
  });

  it("reports each entry that matches", () => {
    tester.run("restricted-classes", rule, {
      valid: [],
      invalid: [
        invalid('<div className="fixed z-50 animate-spin" />', {
          errors: [classes("fixed z-50", FIXED_Z.message), spinError],
          options: { entries: [FIXED_Z, SPIN] },
        }),
        // Mixed: one clean attribute, one banned.
        invalid('<><div className="p-2" /><div className="animate-spin" /></>', {
          errors: [spinError],
        }),
      ],
    });
  });

  it("reads configured callees only", () => {
    tester.run("restricted-classes", rule, {
      valid: [
        valid('<div className={cn("animate-spin")} />', { entries: [SPIN], callees: ["tw"] }),
      ],
      invalid: [
        invalid('<div className={tw("animate-spin")} />', {
          errors: [spinError],
          options: { entries: [SPIN], callees: ["tw"] },
        }),
      ],
    });
  });

  it("bans inline position values with stylePosition", () => {
    const options: Options = { entries: [], stylePosition: POSITION };
    tester.run("restricted-classes", rule, {
      valid: [
        valid('<div style={{ position: "absolute" }} />', options),
        valid('<div style={{ position: "fixed" }} />', DEFAULT),
        // A dynamic style object or value is skipped.
        valid("<div style={styles} />", options),
        valid("<div style={{ position: where }} />", options),
      ],
      invalid: [
        invalid('<div style={{ position: "fixed", top: 0 }} />', {
          errors: [position("fixed", POSITION.message)],
          options: options,
        }),
        invalid('<div style={{ "position": "fixed" }} />', {
          errors: [position("fixed", POSITION.message)],
          options: options,
        }),
        invalid('<div style={{ position: open ? "fixed" : "static" }} />', {
          errors: [position("fixed", POSITION.message)],
          options: options,
        }),
      ],
    });
  });
});
