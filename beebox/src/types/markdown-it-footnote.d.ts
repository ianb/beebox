declare module "markdown-it-footnote" {
  import type MarkdownIt from "markdown-it";

  /** GFM footnotes for markdown-it (`text[^1]` … `[^1]: note`). Ships no types of its own. */
  const footnote: MarkdownIt.PluginSimple;
  export default footnote;
}
