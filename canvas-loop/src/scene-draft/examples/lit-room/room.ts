// A lit Intra room that pans. Shows: a lit group with ambient light and shadows,
// lights that flicker, materials (bevel, emissive screens, shadow casters),
// a camera as a transform outside the lit group, and a wash whose pigment
// moves with the world.
import type { View } from "../scene-api.js";
import { citizenPicture } from "./citizen.js";

export function draw(v: View, model: { frame: number; cameraX: number; walkerX: number }): void {
  v.background("#1a1612");
  // The camera is outside the group, so the wash's pigment moves with the world
  // (draft 2, section 4).
  v.at({ translate: [-model.cameraX, 0] }, () => {
    v.group({ lighting: { ambient: "#2a2833", shadows: "soft" }, effects: { wash: { granulate: 0.4, edges: 0.5 }, paper: 0.3 } }, () => {
      // The room: wall and floor take light; the sofa rounds at its edges.
      v.rect(0, 0, 2400, 600, { fill: "#8a8a6e", material: { relief: 0.1 } });
      v.rect(0, 600, 2400, 160, { fill: "#b9ab8e" });
      v.roundRect(400, 470, 300, 130, 30, { fill: "#a85a3a", stroke: "#241c17", weight: 2, brush: "ink", material: { bevel: 18, shine: 0.2, castsShadow: true } });
      // A bank of screens: they glow by themselves and light the room.
      for (let i = 0; i < 4; i++) {
        const on = Math.sin(model.frame / 7 + i * 1.7) > -0.3;
        const x = 900 + i * 90;
        v.rect(x, 300, 70, 50, { fill: on ? "#7ad8a0" : "#1d3a2a", material: { emissive: on ? 1 : 0 } });
        if (on) v.light({ kind: "point", at: [x + 35, 330], height: 40, color: "#7ad8a0", energy: 0.6, reach: 260 });
      }
      // The ceiling lamp flickers.
      const flicker = 0.85 + 0.15 * Math.sin(model.frame * 1.3) * Math.sin(model.frame * 0.37);
      v.light({ kind: "spot", at: [600, 40], height: 300, direction: Math.PI / 2, cone: 0.7, color: "#ffe2b0", energy: flicker, reach: 700 });
      // A citizen walks through; the shared picture is lit like everything else.
      v.place(citizenPicture(v, { suit: "#3a6a9a", hair: "#2e1d15", number: "B3" }), model.walkerX, 360);
    });
  });
}
