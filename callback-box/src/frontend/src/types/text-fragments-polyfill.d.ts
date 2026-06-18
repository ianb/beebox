/**
 * Minimal types for the subset of text-fragments-polyfill we use. The package
 * ships plain JS (no declarations); we only use the finder. See
 * https://wicg.github.io/scroll-to-text-fragment/ for the directive shape.
 */
declare module "text-fragments-polyfill/text-fragment-utils" {
  interface TextFragment {
    textStart: string;
    textEnd?: string;
    prefix?: string;
    suffix?: string;
  }
  /**
   * Find the ranges matching a text-fragment directive within `root`
   * (defaults to the whole document). Returns up to two matches — more than
   * one means the directive is ambiguous.
   */
  // eslint-disable-next-line max-params -- mirrors the third-party library's own 3-arg signature; we need the `root` arg to scope matching, and can't restructure a published function
  export const processTextFragmentDirective: (textFragment: TextFragment, documentToProcess?: Document, root?: Element) => Range[];
}
