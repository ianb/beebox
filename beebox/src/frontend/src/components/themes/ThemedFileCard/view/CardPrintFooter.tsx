/**
 * The way back from a printed card: at the foot of the printed page, the box
 * and the card's path as the person knows it (no `_content/`), and, when the
 * person asks for it at Print and a phone could reach the address, a QR code
 * of the card's address (shown by `[data-print-qr]`, `lib/print-card.ts`).
 * Print only; nothing on screen.
 */

import { withBase } from "../../../../api-core";
import { toDisplayPath } from "@shared/display-path";
import { isOffMachineOrigin } from "../../../../lib/off-machine-origin";
import { qrSvg } from "../../../../lib/qr-svg";
import { cardUrl } from "@shared/card-url";

/** The card's page at `origin`, for the QR code: the card URL, each path segment encoded. */
export function cardAddress(origin: string, card: { boxSlug: string; path: string }): string {
  const { boxSlug, path } = card;
  return new URL(withBase(cardUrl(boxSlug, path)), origin).toString();
}

/** `here` is the page's own URL; its origin decides the QR code. */
export function CardPrintFooter({ boxSlug, path, here }: { boxSlug: string | undefined; path: string; here: URL }) {
  const qr = isOffMachineOrigin(here) ? qrSvg(cardAddress(here.origin, { boxSlug: boxSlug ?? "", path }), 3) : null;
  return (
    <footer className="bbx-card-print-footer hidden print:flex">
      {qr === null ? null : <div className="bbx-card-print-qr" role="img" aria-label="QR code for this card" dangerouslySetInnerHTML={{ __html: qr }} />}
      <div>
        <div>{boxSlug ?? "Box"} · {toDisplayPath(path)}</div>
        {qr === null ? null : <div className="bbx-card-print-hint">Scan to open this card in the box.</div>}
      </div>
    </footer>
  );
}
