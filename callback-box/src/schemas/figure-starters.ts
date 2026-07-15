// Runnable starter sketches for figure cards — one complete, working `entry`
// module per runtime, scaffolded into `attach/sketch.ts` by the figure
// template. Split from figure.ts to keep the schema file under the line cap.
import type { FigureRuntimeType } from "./figure.js";

/**
 * Runnable starter sketches per runtime. Each one is a complete, working
 * `entry` module: it default-exports `(lib, { mount, figure }) => teardown`,
 * reads `figure.params.size`, and cleans up on teardown. Scaffolded into
 * `attach/sketch.ts` by the figure template so a freshly created figure renders
 * immediately and is ready to edit.
 */
const FIGURE_STARTERS: Record<FigureRuntimeType, string> = {
  p5js: `// p5.js figure. The harness provides p5 as \`lib\` (do not import it) and a
// mount element; read parameters from figure.params.
export default function (p5, { mount, figure }) {
  const instance = new p5((p) => {
    let angle = 0;
    const size = Number(figure.params.size) || 300;
    p.setup = () => {
      p.createCanvas(size, size);
    };
    p.draw = () => {
      p.background(28);
      p.translate(p.width / 2, p.height / 2);
      p.rotate(angle);
      angle += 0.02;
      p.noStroke();
      p.fill(120, 200, 255);
      p.rectMode(p.CENTER);
      p.rect(0, 0, size * 0.4, size * 0.4);
    };
  }, mount);
  return () => instance.remove();
}
`,
  three: `// three.js figure. The harness provides the three namespace as \`lib\`; mount a
// WebGL canvas into \`mount\` and return a teardown that cancels the animation
// frame and disposes GPU resources.
export default function (THREE, { mount, figure }) {
  const size = Number(figure.params.size) || 300;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 100);
  camera.position.z = 2.5;

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(size, size);
  mount.appendChild(renderer.domElement);

  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshNormalMaterial();
  const cube = new THREE.Mesh(geometry, material);
  scene.add(cube);

  let raf = 0;
  const loop = () => {
    cube.rotation.x += 0.01;
    cube.rotation.y += 0.013;
    renderer.render(scene, camera);
    raf = requestAnimationFrame(loop);
  };
  loop();

  return () => {
    cancelAnimationFrame(raf);
    geometry.dispose();
    material.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  };
}
`,
  d3: `// D3 figure. The harness provides the d3 namespace as \`lib\`; append an <svg>
// to \`mount\` and return a teardown that removes it.
export default function (d3, { mount, figure }) {
  const size = Number(figure.params.size) || 300;
  const data = [4, 8, 15, 16, 23, 42];

  const svg = d3
    .select(mount)
    .append("svg")
    .attr("width", size)
    .attr("height", size);

  const x = d3
    .scaleBand()
    .domain(data.map((_, i) => String(i)))
    .range([0, size])
    .padding(0.1);
  const y = d3
    .scaleLinear()
    .domain([0, d3.max(data) ?? 0])
    .range([size, 0]);

  svg
    .selectAll("rect")
    .data(data)
    .join("rect")
    .attr("x", (_, i) => x(String(i)) ?? 0)
    .attr("y", (d) => y(d))
    .attr("width", x.bandwidth())
    .attr("height", (d) => size - y(d))
    .attr("fill", "#4ea3ff");

  return () => {
    svg.remove();
  };
}
`,
  "canvas-loop": `// canvas-loop figure: a TEA sketch (named exports) plus the figure factory
// (default export). The named exports run headlessly through the canvas-loop
// CLI — verify with that loop, not screenshots. Import canvas-loop TYPES only;
// the browser API arrives as the factory's \`cl\` argument.
import type { DeepReadonly, Msg, ParamsDecl, ParamValues, Util, View } from "@ianbicking/canvas-loop";

export const params = {
  speed: { type: "number", min: 0, max: 5, default: 1 },
  "show-ring": { type: "boolean", default: true },
  tone: { type: "select", options: ["sky", "ember", "moss"], default: "sky" },
  reset: { type: "trigger" },
} as const satisfies ParamsDecl;

export const canvas = { width: 400, height: 300 };

const TONES: Record<string, string> = { sky: "#7dd3fc", ember: "#fb923c", moss: "#86efac" };

export type Model = { angle: number };

export function init(): Model {
  return { angle: 0 };
}

export function update(model: DeepReadonly<Model>, msg: Msg, u: Util<typeof params>): Model {
  switch (msg.type) {
    case "tick":
      return { angle: model.angle + 0.03 * u.params.speed };
    case "trigger":
      return msg.name === "reset" ? init() : model;
    case "param":
    case "mousedown":
    case "mouseup":
    case "mousemove":
    case "keydown":
    case "keyup":
      return model;
  }
}

export function draw(v: View, model: DeepReadonly<Model>, p: ParamValues<typeof params>): void {
  v.background("#0b0e17");
  const cx = v.width / 2;
  const cy = v.height / 2;
  const orbit = 90;
  if (p["show-ring"]) {
    v.noFill();
    v.stroke("#334155");
    v.circle(cx, cy, orbit * 2);
  }
  v.noStroke();
  v.fill(TONES[p.tone] ?? "#7dd3fc");
  v.circle(cx + orbit * Math.cos(model.angle), cy + orbit * Math.sin(model.angle), 24);
}

export default (cl, { mount, figure }) =>
  cl.mountSketch(mount, { module: { params, canvas, init, update, draw }, initialParams: figure.params });
`,
};

/** The runnable starter sketch source for a runtime (for the \`entry\` file). */
export function figureStarterSketch(runtime: FigureRuntimeType): string {
  return FIGURE_STARTERS[runtime];
}
