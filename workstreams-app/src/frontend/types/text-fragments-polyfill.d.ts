/**
 * Minimal types for the subset of text-fragments-polyfill this app uses. The
 * package ships plain JS with no declarations. callback-box declares the finder
 * half the same way (`src/frontend/src/types/text-fragments-polyfill.d.ts`);
 * this adds the GENERATOR half, which is the piece that turns a live selection
 * into a durable anchor.
 *
 * Directive shape: https://wicg.github.io/scroll-to-text-fragment/
 */
declare module "text-fragments-polyfill/text-fragment-utils" {
  interface TextFragment {
    textStart: string;
    textEnd?: string;
    prefix?: string;
    suffix?: string;
  }
  /**
   * Find the ranges matching a directive within `root`. Returns up to two
   * matches — more than one means the directive is ambiguous.
   */
  // eslint-disable-next-line max-params -- mirrors the third-party library's own 3-arg signature; the `root` arg scopes matching and a published function cannot be restructured
  export const processTextFragmentDirective: (textFragment: TextFragment, documentToProcess?: Document, root?: Element) => Range[];
}

declare module "text-fragments-polyfill/dist/fragment-generation-utils.js" {
  interface GeneratedTextFragment {
    prefix?: string;
    textStart?: string;
    textEnd?: string;
    suffix?: string;
  }
  /**
   * `status` 0 is SUCCESS; 1 INVALID_SELECTION, 2 AMBIGUOUS, 3 TIMEOUT,
   * 4 EXECUTION_FAILED. Anything but 0 means no usable fragment — an ordinary
   * outcome, since the quoted text is what carries the comment's meaning.
   */
  export const generateFragment: (selection: Selection, startTime?: Date) => {
    status: number;
    fragment?: GeneratedTextFragment;
  };
}
