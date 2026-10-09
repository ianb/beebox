// Markup for pages that compare models on a set of samples: a pill per model,
// a graded verdict, and a box stating what a sample is and what it tests.
import Markdoc from "@markdoc/markdoc";
import type { Config, Node, RenderableTreeNode } from "@markdoc/markdoc";

// eslint-disable-next-line import-x/no-named-as-default-member -- CJS interop: only the default namespace carries these at runtime
const { Tag } = Markdoc;

const VENDORS = ["google", "openai"] as const;
export const VERDICTS = { correct: "Correct", okay: "Okay", failed: "Failed" } as const;
const VERDICT_ICONS: Record<keyof typeof VERDICTS, string> = { correct: "✓", okay: "~", failed: "✗" };

function isVerdict(value: string): value is keyof typeof VERDICTS {
  return Object.hasOwn(VERDICTS, value);
}

export const evaluationTags = {
  model: {
    selfClosing: true,
    inline: true,
    attributes: {
      name: { type: String, required: true },
      vendor: { type: String, required: true, matches: [...VENDORS] },
    },
    transform(node: Node, config: Config): RenderableTreeNode {
      const attrs = node.transformAttributes(config);
      const name = String(attrs["name"] ?? "");
      if (name.trim() === "") throw new Error("model needs a name");
      return new Tag("span", { class: `model-pill model-${String(attrs["vendor"])}` }, [name]);
    },
  },
  verdict: {
    selfClosing: true,
    inline: true,
    attributes: { is: { type: String, required: true, matches: Object.keys(VERDICTS) } },
    transform(node: Node, config: Config): RenderableTreeNode {
      const value = String(node.transformAttributes(config)["is"] ?? "");
      if (!isVerdict(value)) throw new Error(`verdict must be one of ${Object.keys(VERDICTS).join(", ")}`);
      // The icon is decorative; the word carries the meaning without color.
      return new Tag("span", { class: `verdict verdict-${value}` }, [
        new Tag("span", { "aria-hidden": "true" }, [VERDICT_ICONS[value]]),
        ` ${VERDICTS[value]}`,
      ]);
    },
  },
  sample: {
    // A box of paragraphs cannot sit inside a paragraph.
    inline: false,
    attributes: { title: { type: String, required: true } },
    transform(node: Node, config: Config): RenderableTreeNode {
      const title = String(node.transformAttributes(config)["title"] ?? "");
      if (title.trim() === "") throw new Error("sample needs a title");
      if (node.children.length === 0) throw new Error(`sample "${title}" needs a body saying what was recorded and what it tests`);
      return new Tag("div", { class: "sample-spec" }, [
        new Tag("p", { class: "sample-title" }, [title]),
        ...node.transformChildren(config),
      ]);
    },
  },
};

/** Literal text in the twin: a name must not turn into Markdown syntax. */
function escapeMarkdown(text: string): string {
  return text.replace(/[#*<>[\\\]_`|]/g, (c) => `\\${c}`);
}

const ATTRIBUTE = { name: /\bname="([^"]*)"/, is: /\bis="([^"]*)"/, title: /\btitle="([^"]*)"/ } as const;

function attribute(attrs: string, name: keyof typeof ATTRIBUTE): string {
  return ATTRIBUTE[name].exec(attrs)?.[1] ?? "";
}

/** The machine-facing twin keeps what each tag says, in plain Markdown. */
export function flattenEvaluationTags(markdown: string): string {
  return markdown
    .replace(/{%\s*model\b([^%]*)\/%}/g, (_m, attrs: string) => `**${escapeMarkdown(attribute(attrs, "name"))}**`)
    .replace(/{%\s*verdict\b([^%]*)\/%}/g, (_m, attrs: string) => {
      const value = attribute(attrs, "is");
      return `[${isVerdict(value) ? VERDICTS[value] : escapeMarkdown(value)}]`;
    })
    .replace(/{%\s*sample\b([^%]*?)\s*%}/g, (_m, attrs: string) => `**Sample: ${escapeMarkdown(attribute(attrs, "title"))}**\n`);
}
