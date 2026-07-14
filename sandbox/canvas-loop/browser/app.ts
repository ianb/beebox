// The playground page: a tab bar over the bundled sketches, a live canvas driven
// by the browser Runtime, an auto-generated param panel, and a record panel that
// serialises every interaction to the headless events-file format. All wiring
// goes through the Runtime's input methods, so hand interaction and scripted
// replay converge on one representation.
import type { CanvasSize } from "../src/tea.js";
import { buildControls } from "./controls.js";
import { REGISTRY } from "./registry.js";
import type { RegistryEntry } from "./sketch-types.js";
import { Runtime } from "./runtime.js";
import type { RuntimeLog } from "./runtime.js";

const DEFAULT_CANVAS: CanvasSize = { width: 400, height: 300 };
const MAX_LOG_LINES = 200;

interface Session {
  runtime: Runtime;
  canvas: HTMLCanvasElement;
  pressed: boolean;
}

class Playground {
  #root: HTMLElement;
  #tabs: HTMLElement;
  #canvasWrap: HTMLElement;
  #controlsHost: HTMLElement;
  #frameReadout: HTMLElement;
  #pauseBtn: HTMLButtonElement;
  #seedInput: HTMLInputElement;
  #scaleBtn: HTMLButtonElement;
  #logHost: HTMLElement;
  #eventsArea: HTMLTextAreaElement;
  #eventsSummary: HTMLElement;
  #scale = 1;
  #logLines: string[] = [];
  #session: Session | undefined;
  #entry: RegistryEntry;

  constructor(root: HTMLElement) {
    this.#root = root;
    const first = REGISTRY[0];
    if (first === undefined) throw new PlaygroundError({ detail: "registry is empty" });
    this.#entry = first;
    this.#tabs = el("nav", "tabs");
    this.#canvasWrap = el("div", "canvas-wrap");
    this.#controlsHost = el("div", "controls-host");
    this.#frameReadout = el("span", "frame-readout");
    this.#pauseBtn = button("Pause", "ctl-btn");
    this.#scaleBtn = button("1x", "ctl-btn");
    this.#seedInput = document.createElement("input");
    this.#logHost = el("pre", "log");
    this.#eventsArea = document.createElement("textarea");
    this.#eventsSummary = document.createElement("summary");
    this.#build();
    this.#select(this.#entry);
  }

  // ── page scaffold ────────────────────────────────────────────────
  #build(): void {
    const header = el("header", "topbar");
    const title = el("h1", "title");
    title.textContent = "canvas-loop playground";
    for (const entry of REGISTRY) {
      const tab = button(entry.label, "tab");
      tab.dataset["id"] = entry.id;
      tab.addEventListener("click", () => this.#select(entry));
      this.#tabs.append(tab);
    }
    header.append(title, this.#tabs);

    const canvasCol = el("div", "canvas-col");
    canvasCol.append(this.#canvasWrap, this.#buildToolbar());

    const side = el("aside", "side");
    side.append(this.#buildControlsPanel(), this.#buildRecordPanel(), this.#buildLogPanel());

    const stage = el("main", "stage");
    stage.append(canvasCol, side);
    this.#root.append(header, stage);
  }

  #buildToolbar(): HTMLElement {
    const bar = el("div", "toolbar");
    this.#seedInput.type = "number";
    this.#seedInput.className = "seed-input";
    this.#seedInput.value = "42";
    const restart = button("Restart", "ctl-btn");
    restart.addEventListener("click", () => this.#restart());
    this.#pauseBtn.addEventListener("click", () => this.#togglePause());
    this.#scaleBtn.addEventListener("click", () => this.#toggleScale());
    bar.append(this.#frameReadout, this.#pauseBtn, restart, labeled("seed", this.#seedInput), labeled("view", this.#scaleBtn));
    return bar;
  }

  #buildControlsPanel(): HTMLElement {
    const panel = el("section", "panel");
    const h = el("h2", "panel-title");
    h.textContent = "Parameters";
    panel.append(h, this.#controlsHost);
    return panel;
  }

  #buildRecordPanel(): HTMLElement {
    const panel = el("section", "panel");
    const h = el("h2", "panel-title");
    h.textContent = "Record";
    const copy = button("Copy events JSON", "ctl-btn wide");
    copy.addEventListener("click", () => this.#copyEvents());
    const details = document.createElement("details");
    this.#eventsSummary.textContent = "Recorded events (0)";
    this.#eventsArea.className = "events-area";
    this.#eventsArea.readOnly = true;
    this.#eventsArea.rows = 10;
    this.#eventsArea.addEventListener("focus", () => this.#refreshEvents());
    details.append(this.#eventsSummary, this.#eventsArea);
    details.addEventListener("toggle", () => this.#refreshEvents());
    panel.append(h, copy, details);
    return panel;
  }

  #buildLogPanel(): HTMLElement {
    const panel = el("section", "panel");
    const h = el("h2", "panel-title");
    h.textContent = "Transcript";
    panel.append(h, this.#logHost);
    return panel;
  }

  // ── sketch selection ─────────────────────────────────────────────
  #select(entry: RegistryEntry): void {
    this.#session?.runtime.stop();
    this.#entry = entry;
    this.#logLines = [];
    this.#logHost.textContent = "";
    const size = entry.module.canvas ?? DEFAULT_CANVAS;
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    canvas.className = "sketch-canvas";
    canvas.tabIndex = 0;
    this.#canvasWrap.replaceChildren(canvas);
    this.#applyScale(canvas);
    const ctx = canvas.getContext("2d");
    if (ctx === null) throw new PlaygroundError({ detail: "2d context unavailable" });
    const runtime = new Runtime({
      module: entry.module,
      ctx,
      width: size.width,
      height: size.height,
      seed: this.#readSeed(),
      onFrame: (frame) => this.#onFrame(frame),
      onLog: (line) => this.#onLog(line),
    });
    const session: Session = { runtime, canvas, pressed: false };
    this.#session = session;
    this.#wireInput(session);
    this.#renderControls(runtime);
    this.#pauseBtn.textContent = "Pause";
    this.#onFrame(0);
    this.#refreshEvents();
    this.#markActiveTab();
    runtime.start();
  }

  #renderControls(runtime: Runtime): void {
    const panel = buildControls({
      decl: this.#entry.module.params ?? {},
      values: runtime.paramValues(),
      onParam: (name, value) => runtime.setParam(name, value),
      onTrigger: (name) => runtime.trigger(name),
    });
    this.#controlsHost.replaceChildren(panel);
  }

  #markActiveTab(): void {
    for (const tab of this.#tabs.children) {
      if (tab instanceof HTMLElement) tab.classList.toggle("active", tab.dataset["id"] === this.#entry.id);
    }
  }

  // ── input wiring (all through Runtime) ───────────────────────────
  #wireInput(session: Session): void {
    const { canvas, runtime } = session;
    canvas.addEventListener("mousedown", (e) => {
      session.pressed = true;
      canvas.focus();
      const p = coords(canvas, e);
      runtime.pointer({ type: "mousedown", x: p.x, y: p.y });
    });
    canvas.addEventListener("mousemove", (e) => {
      if (!session.pressed) return;
      const p = coords(canvas, e);
      runtime.pointer({ type: "mousemove", x: p.x, y: p.y });
    });
    const release = (e: MouseEvent): void => {
      if (!session.pressed) return;
      session.pressed = false;
      const p = coords(canvas, e);
      runtime.pointer({ type: "mouseup", x: p.x, y: p.y });
    };
    canvas.addEventListener("mouseup", release);
    canvas.addEventListener("mouseleave", release);
    canvas.addEventListener("keydown", (e) => {
      if (e.repeat) return;
      if (e.key.startsWith("Arrow")) e.preventDefault();
      runtime.key({ type: "keydown", key: e.key });
    });
    canvas.addEventListener("keyup", (e) => runtime.key({ type: "keyup", key: e.key }));
  }

  // ── toolbar actions ──────────────────────────────────────────────
  #restart(): void {
    this.#logLines = [];
    this.#logHost.textContent = "";
    this.#session?.runtime.restart(this.#readSeed());
    this.#refreshEvents();
  }

  #togglePause(): void {
    const runtime = this.#session?.runtime;
    if (runtime === undefined) return;
    runtime.setPaused(!runtime.paused);
    this.#pauseBtn.textContent = runtime.paused ? "Resume" : "Pause";
  }

  #toggleScale(): void {
    this.#scale = this.#scale === 1 ? 2 : 1;
    this.#scaleBtn.textContent = `${this.#scale}x`;
    if (this.#session !== undefined) this.#applyScale(this.#session.canvas);
  }

  #applyScale(canvas: HTMLCanvasElement): void {
    canvas.style.width = `${canvas.width * this.#scale}px`;
    canvas.style.height = `${canvas.height * this.#scale}px`;
  }

  #readSeed(): number {
    const value = Number(this.#seedInput.value);
    return Number.isFinite(value) ? Math.trunc(value) : 42;
  }

  // ── record + transcript ──────────────────────────────────────────
  #copyEvents(): void {
    this.#refreshEvents();
    const text = this.#session?.runtime.eventsJSON() ?? "[]";
    if (typeof navigator !== "undefined" && navigator.clipboard !== undefined) {
      void navigator.clipboard.writeText(text).catch(() => {
        // Clipboard may be blocked (permissions/insecure context); the textarea
        // still shows the JSON, so a copy failure needs no surfacing.
      });
    }
    this.#eventsArea.select();
  }

  #refreshEvents(): void {
    const runtime = this.#session?.runtime;
    if (runtime === undefined) return;
    this.#eventsArea.value = runtime.eventsJSON();
    this.#eventsSummary.textContent = `Recorded events (${runtime.eventCount()})`;
  }

  #onFrame(frame: number): void {
    this.#frameReadout.textContent = `frame ${frame}`;
    const runtime = this.#session?.runtime;
    if (runtime !== undefined) this.#eventsSummary.textContent = `Recorded events (${runtime.eventCount()})`;
  }

  #onLog(line: RuntimeLog): void {
    this.#logLines.push(`[frame ${line.frame}] ${line.message}`);
    if (this.#logLines.length > MAX_LOG_LINES) this.#logLines = this.#logLines.slice(-MAX_LOG_LINES);
    this.#logHost.textContent = this.#logLines.join("\n");
    this.#logHost.scrollTop = this.#logHost.scrollHeight;
  }
}

class PlaygroundError extends Error {
  name = "PlaygroundError";
  constructor(options: { detail: string }) {
    super(`playground: ${options.detail}`);
  }
}

function el(tag: string, className: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

function button(text: string, className: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = className;
  b.textContent = text;
  return b;
}

function labeled(name: string, control: HTMLElement): HTMLElement {
  const wrap = el("label", "toolbar-field");
  const caption = document.createElement("span");
  caption.textContent = name;
  wrap.append(caption, control);
  return wrap;
}

function coords(canvas: HTMLCanvasElement, e: MouseEvent): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  const sx = rect.width === 0 ? 1 : canvas.width / rect.width;
  const sy = rect.height === 0 ? 1 : canvas.height / rect.height;
  return { x: Math.round((e.clientX - rect.left) * sx), y: Math.round((e.clientY - rect.top) * sy) };
}

function mount(): void {
  const root = document.getElementById("app") ?? document.body;
  const container = el("div", "playground");
  root.append(container);
  const app = new Playground(container);
  void app;
}

mount();
