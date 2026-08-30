// Runnable starter sketches for figure cards — one complete, working `entry`
// module per runtime, scaffolded into `attach/sketch.ts` by the figure
// template. Split from figure.ts to keep the schema file under the line cap.
import type { FigureRuntimeType } from "./figure.js";

/**
 * Runnable starter sketches per runtime. Each one is a complete, working
 * `entry` module: it default-exports `(lib, { mount, figure }) => teardown`
 * and cleans up on teardown. The p5/three/d3 starters size themselves from
 * the mount container (a `ResizeObserver`-driven fit, not a `size` param —
 * see the schema instructions' "Fit the container" guidance) so they render
 * correctly at any embed width, phone included. Scaffolded into
 * `attach/sketch.ts` by the figure template so a freshly created figure renders
 * immediately and is ready to edit.
 */
const FIGURE_STARTERS: Record<FigureRuntimeType, string> = {
  p5js: `// p5.js figure. The harness provides p5 as \`lib\` (do not import it) and a
// mount element. Size from the container, not a fixed pixel width, so the
// figure fits at phone width too.
export default function (p5, { mount, figure }) {
  const width = () => Math.min(mount.clientWidth || 360, 640);
  let angle = 0;
  const instance = new p5((p) => {
    p.setup = () => {
      p.createCanvas(width(), width());
    };
    p.draw = () => {
      // Derive ALL layout from p.width / p.height, not captured constants —
      // resizeCanvas below changes them without re-running setup.
      p.background(28);
      p.translate(p.width / 2, p.height / 2);
      p.rotate(angle);
      angle += 0.02;
      p.noStroke();
      p.fill(120, 200, 255);
      p.rectMode(p.CENTER);
      p.rect(0, 0, p.width * 0.4, p.height * 0.4);
    };
  }, mount);
  // The width-compare guard breaks the observer feedback loop (resizeCanvas
  // changes the mount's height, which would otherwise refire the observer).
  const ro = new ResizeObserver(() => {
    if (instance.width !== width()) instance.resizeCanvas(width(), width());
  });
  ro.observe(mount);
  return () => {
    ro.disconnect();
    instance.remove();
  };
}
`,
  three: `// three.js figure. The harness provides the three namespace as \`lib\`; mount a
// WebGL canvas into \`mount\` and return a teardown that cancels the animation
// frame and disposes GPU resources. Size from the container so the figure
// fits at phone width too.
export default function (THREE, { mount, figure }) {
  const width = () => Math.min(mount.clientWidth || 360, 640);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 100);
  camera.position.z = 2.5;

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  mount.appendChild(renderer.domElement);

  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshNormalMaterial();
  const cube = new THREE.Mesh(geometry, material);
  scene.add(cube);

  // Track the logical width ourselves: renderer.domElement.width is physical
  // pixels, which diverges from the logical size under setPixelRatio.
  let canvasW = 0;
  function resize(): void {
    canvasW = width();
    renderer.setSize(canvasW, canvasW);
    camera.aspect = 1;
    camera.updateProjectionMatrix();
  }
  resize();

  let raf = 0;
  const loop = () => {
    cube.rotation.x += 0.01;
    cube.rotation.y += 0.013;
    renderer.render(scene, camera);
    raf = requestAnimationFrame(loop);
  };
  loop();

  const ro = new ResizeObserver(() => {
    if (canvasW !== width()) resize();
  });
  ro.observe(mount);

  return () => {
    ro.disconnect();
    cancelAnimationFrame(raf);
    geometry.dispose();
    material.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  };
}
`,
  d3: `// D3 figure. The harness provides the d3 namespace as \`lib\`; append an <svg>
// with a viewBox so it scales to the container — no resize handling needed,
// since d3.pointer() maps events into the viewBox's own coordinate system.
// Keep the internal width modest and text >= 12px: viewBox scaling shrinks
// text and strokes uniformly, so labels must stay legible even scaled down
// to phone width.
export default function (d3, { mount, figure }) {
  const W = 600;
  const H = 400;
  const data = [4, 8, 15, 16, 23, 42];

  const svg = d3
    .select(mount)
    .append("svg")
    .attr("viewBox", \`0 0 \${W} \${H}\`)
    .style("width", "100%")
    .style("height", "auto");

  const x = d3
    .scaleBand()
    .domain(data.map((_, i) => String(i)))
    .range([0, W])
    .padding(0.1);
  const y = d3
    .scaleLinear()
    .domain([0, d3.max(data) ?? 0])
    .range([H, 0]);

  svg
    .selectAll("rect")
    .data(data)
    .join("rect")
    .attr("x", (_, i) => x(String(i)) ?? 0)
    .attr("y", (d) => y(d))
    .attr("width", x.bandwidth())
    .attr("height", (d) => H - y(d))
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
