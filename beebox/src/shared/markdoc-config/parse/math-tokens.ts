/**
 * Turn the dollar-math tokens (`math-rule.ts`) into Markdoc `math` tags.
 *
 * Markdoc's parser keeps no `content` or `meta` for token types it does not
 * know, so each token becomes a self-closing `math` tag carrying the TeX as
 * its `tex` attribute and display mode as `display`, as footnotes do
 * (`footnote-tokens.ts`). The tag is render-only: the frontend renderer
 * declares it, the shared tag table does not.
 */

import type Token from "markdown-it/lib/token.js";

function asMathTag(token: Token, display: boolean): Token {
  token.type = "tag";
  token.meta = {
    tag: "math",
    attributes: [
      { type: "attribute", name: "tex", value: token.content },
      { type: "attribute", name: "display", value: display },
    ],
  };
  return token;
}

function inlineDisplay(token: Token): boolean {
  const meta: unknown = token.meta;
  return typeof meta === "object" && meta !== null && "display" in meta && meta.display === true;
}

/** Rewrite math tokens in a block token stream. */
export function rewriteMathTokens(tokens: Token[]): Token[] {
  for (const token of tokens) {
    if (token.type === "math_block") asMathTag(token, true);
    else if (token.type === "inline" && token.children !== null) {
      for (const child of token.children) {
        if (child.type === "math_inline") asMathTag(child, inlineDisplay(child));
      }
    }
  }
  return tokens;
}
