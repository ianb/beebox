/**
 * The way back from a printed card: at the foot of the printed page, the box
 * and the card's path as the person knows it (no `_content/`), and a QR code
 * of the card's address when a phone could reach it. Print only; nothing on
 * screen.
 */

import { withBase } from "../../../../api-core";
import { toDisplayPath } from "@shared/display-path";
import { encodePathForUrl } from "../../../../lib/view-url";
import { isOffMachineOrigin } from "../../../../lib/off-machine-origin";
import { qrSvg } from "../../../../lib/qr-svg";

export function CardPrintFooter({ boxSlug, path }: { boxSlug: string | undefined; path: string }) {
  const here = new URL(window.location.href);
  const address = new URL(withBase(`/${boxSlug ?? ""}/browse/${encodePathForUrl(path.replace(/^\//, ""))}`), here.origin).toString();
  const qr = isOffMachineOrigin(here) ? qrSvg(address, 3) : null;
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
