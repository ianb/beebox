// A computed field shown as pixels (the rare case that used putImageData).
// Shows `pixels`: the fill runs only when its deps change, then the picture is
// placed and scaled like any other.
import type { View } from "../scene-api.js";

export function draw(v: View, model: { wavelength: number; frame: number }): void {
  const w = 160, h = 100;
  const field = v.pixels({ key: "interference", deps: [model.wavelength], width: w, height: h }, ({ data, width, height }) => {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const d1 = Math.hypot(x - 50, y - 50), d2 = Math.hypot(x - 110, y - 50);
        const a = 0.5 + 0.25 * (Math.cos((d1 / model.wavelength) * Math.PI * 2) + Math.cos((d2 / model.wavelength) * Math.PI * 2));
        const i = (y * width + x) * 4;
        data[i] = 40;
        data[i + 1] = Math.round(120 + 120 * a);
        data[i + 2] = Math.round(200 * a);
        data[i + 3] = 255;
      }
    }
  });
  v.at({ scale: 4 }, () => v.place(field, 0, 0));
  v.text(`λ = ${model.wavelength}`, { x: 12, y: 12 }, { size: 14, fill: "#fff" });
}
