import qrcode from "qrcode-generator";

/** An SVG QR code for `value`, as markup to set with `dangerouslySetInnerHTML`. */
export function qrSvg(value: string, cellSize: number): string {
  const qr = qrcode(0, "M");
  qr.addData(value);
  qr.make();
  return qr.createSvgTag({ cellSize, margin: 3 });
}
