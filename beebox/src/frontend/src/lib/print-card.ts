/**
 * Print one card. Cmd-P prints the whole screen, and in a chat workspace that
 * is the transcript and every open card. The card's Print control marks the
 * card and the elements that contain it, so the print CSS
 * (`html[data-print-scope="card"]` in card-themes.css) hides everything else,
 * then clears the marks when printing ends. The footer's QR code prints only
 * when the person asked for it (`data-print-qr`).
 */

const TARGET = "data-print-target";
const PATH = "data-print-path";
const QR = "data-print-qr";

function clearMarks(): void {
  delete document.documentElement.dataset.printScope;
  for (const node of document.querySelectorAll(`[${TARGET}], [${PATH}]`)) {
    node.removeAttribute(TARGET);
    node.removeAttribute(PATH);
    node.removeAttribute(QR);
  }
}

export function printCard(card: HTMLElement, options: { qr: boolean }): void {
  clearMarks();
  card.setAttribute(TARGET, "");
  card.toggleAttribute(QR, options.qr);
  for (let node = card.parentElement; node !== null && node !== document.body; node = node.parentElement) node.setAttribute(PATH, "");
  document.documentElement.dataset.printScope = "card";
  // Chrome and Safari block in print() until the dialog closes; Firefox
  // returns at once and fires afterprint later.
  window.addEventListener("afterprint", clearMarks, { once: true });
  window.print();
}
