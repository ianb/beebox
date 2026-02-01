declare module "@parcel/markdown-ansi" {
  /**
   * Convert markdown text to ANSI-colored terminal output.
   */
  function mdAnsi(markdown: string): string;
  export default mdAnsi;
}
