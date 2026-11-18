// Question cards: a run of small cards, one per question. An answered
// question is an index card; an open one is a sticky note.
import Markdoc from "@markdoc/markdoc";
import type { Config, Node, RenderableTreeNode } from "@markdoc/markdoc";

// eslint-disable-next-line import-x/no-named-as-default-member -- CJS interop: only the default namespace carries these at runtime
const { Tag } = Markdoc;

/** The words on each card that say which kind it is; the color alone must not carry it. */
export const QUESTION_STATES = { answered: "Bee Box has an answer", open: "Still open" } as const;

function isState(value: string): value is keyof typeof QUESTION_STATES {
  return Object.hasOwn(QUESTION_STATES, value);
}

export const questionTags = {
  questions: {
    inline: false,
    transform(node: Node, config: Config): RenderableTreeNode {
      // A stray paragraph would become a grid cell with no card around it.
      if (node.children.length === 0 || node.children.some((child) => child.type !== "tag" || child.tag !== "question")) {
        throw new Error("questions must contain only question tags, and at least one");
      }
      return new Tag("div", { class: "question-cards" }, node.transformChildren(config));
    },
  },
  question: {
    inline: false,
    attributes: { state: { type: String, required: true, matches: Object.keys(QUESTION_STATES) } },
    transform(node: Node, config: Config): RenderableTreeNode {
      const state = String(node.transformAttributes(config)["state"] ?? "");
      if (!isState(state)) throw new Error(`question state must be one of ${Object.keys(QUESTION_STATES).join(", ")}`);
      if (node.children.length === 0) throw new Error("question needs a body");
      return new Tag("div", { class: `question-card question-${state}` }, [
        ...node.transformChildren(config),
        new Tag("p", { class: "question-state" }, [QUESTION_STATES[state]]),
      ]);
    },
  },
};

/** The machine-facing twin keeps each card's kind as a line of text above it. */
export function flattenQuestionTags(markdown: string): string {
  return markdown.replace(/{%\s*question\s[^%]*?\bstate="([^"]*)"[^%]*%}/g, (_m, state: string) =>
    isState(state) ? `_${QUESTION_STATES[state]}:_\n` : "",
  );
}
