// Agent-directed text is a named, addressable, copyable surface, not a generic code sample.
import Markdoc from "@markdoc/markdoc";
import type { Config, Node, RenderableTreeNode } from "@markdoc/markdoc";

// eslint-disable-next-line import-x/no-named-as-default-member -- CJS interop: only the default namespace carries these at runtime
const { Tag } = Markdoc;

export const agentPromptTags = {
  "agent-prompt": {
    attributes: { title: { type: String, required: true }, id: { type: String, required: true } },
    transform(node: Node, config: Config): RenderableTreeNode {
      const attrs = node.transformAttributes(config);
      const title = String(attrs["title"] ?? "");
      const id = String(attrs["id"] ?? "");
      const fence = node.children[0];
      const text: unknown = fence?.attributes["content"];
      if (node.inline || node.children.length !== 1 || fence?.type !== "fence" || typeof text !== "string" || text.trim() === "") {
        throw new Error(`agent-prompt "${title}" must contain exactly one nonempty fenced prompt`);
      }
      if (title.trim() === "" || !/^[\da-z][\da-z-]*$/.test(id)) throw new Error("agent-prompt needs a title and a stable lowercase id");
      return new Tag("section", { class: "agent-prompt", id, "aria-labelledby": `${id}-title` }, [
        new Tag("div", { class: "prompt-heading" }, [
          new Tag("span", { class: "prompt-audience" }, ["For your agent"]),
          new Tag("strong", { id: `${id}-title` }, [title]),
        ]),
        new Tag("pre", { tabindex: "0" }, [new Tag("code", {}, [text])]),
        new Tag("div", { class: "prompt-actions" }, [
          new Tag("button", { type: "button", class: "prompt-copy", hidden: true, "aria-label": `Copy prompt: ${title}` }, ["Copy prompt"]),
          new Tag("span", { class: "prompt-status", role: "status" }, []),
        ]),
      ]);
    },
  },
};
