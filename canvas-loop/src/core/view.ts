// The drawing half of the TEA `View`, shared by the headless and browser
// runtimes: every call goes straight to the Painter with its style. Each
// runtime adds what differs between them (the raw `ctx`, `cursor`, `control`,
// `log`, `snapshot`).
import type { Paper } from "./brush/types.js";
import { curveCommands } from "./contours.js";
import type {
  AtOptions,
  ClipShape,
  ColorStop,
  GroupOptions,
  LinearGradient,
  Paint,
  PasteOptions,
  PathCommand,
  RadialGradient,
  Sprite,
  SpriteOptions,
  Style,
  TextBounds,
  TextBox,
  TextOptions,
  Vec2,
} from "./paint.js";
import { ellipseGradient, linearGradient, radialGradient } from "./paint.js";
import { offsetPoints, tubePath } from "./shapes.js";
import type { TubeOptions } from "./shapes.js";
import type { Painter } from "./painter/engine.js";

export class PainterView {
  protected readonly painter: Painter;

  constructor(painter: Painter) {
    this.painter = painter;
  }

  get width(): number {
    return this.painter.width;
  }
  get height(): number {
    return this.painter.height;
  }

  background(paint: Paint): void {
    this.painter.background(paint);
  }
  rect(...args: [number, number, number, number, Style]): void {
    this.painter.rect(...args);
  }
  roundRect(...args: [number, number, number, number, number, Style]): void {
    this.painter.roundRect(...args);
  }
  circle(...args: [number, number, number, Style]): void {
    this.painter.circle(...args);
  }
  ellipse(...args: [number, number, number, number, Style]): void {
    this.painter.ellipse(...args);
  }
  line(...args: [number, number, number, number, Style]): void {
    this.painter.line(...args);
  }
  triangle(...args: [number, number, number, number, number, number, Style]): void {
    this.painter.triangle(...args);
  }
  arc(...args: [number, number, number, number, number, Style]): void {
    this.painter.arc(...args);
  }
  polygon(points: readonly Vec2[], style: Style): void {
    this.painter.polygon(points, style);
  }
  path(commands: readonly PathCommand[], style: Style): void {
    this.painter.path(commands, style);
  }
  curve(...args: [readonly Vec2[], boolean, Style]): void {
    this.painter.curve(...args);
  }
  curvePath(points: readonly Vec2[], closed?: boolean): PathCommand[] {
    return curveCommands(points, closed ?? false);
  }
  tube(points: readonly Vec2[], options: TubeOptions): PathCommand[] {
    return tubePath(points, options);
  }
  offset(points: readonly Vec2[], distance: number): Vec2[] {
    return offsetPoints(points, distance);
  }
  linearGradient(...args: [number, number, number, number, readonly ColorStop[]]): LinearGradient {
    return linearGradient(...args);
  }
  radialGradient(...args: [number, number, number, readonly ColorStop[]]): RadialGradient {
    return radialGradient(...args);
  }
  ellipseGradient(...args: [number, number, number, number, readonly ColorStop[]]): RadialGradient {
    return ellipseGradient(...args);
  }
  text(...args: [string, TextBox, TextOptions?]): TextBounds {
    return this.painter.text(...args);
  }
  textWidth(content: string, options?: TextOptions): number {
    return this.painter.textWidth(content, options);
  }
  at(options: AtOptions, body: () => void): void {
    this.painter.at(options, body);
  }
  group(options: GroupOptions, body: () => void): void {
    this.painter.group(options, body);
  }
  clip(shape: ClipShape | readonly ClipShape[], body: () => void): void {
    this.painter.clip(shape, body);
  }
  cache(...args: [string, () => void, Omit<PasteOptions, "opacity">?]): void {
    this.painter.cache(...args);
  }
  sprite(options: SpriteOptions, body: () => void): Sprite {
    return this.painter.sprite(options, body);
  }
  image(...args: [Sprite, number, number, PasteOptions?]): void {
    this.painter.image(...args);
  }
  paper(paper: Paper): void {
    this.painter.paper(paper);
  }
  paperTexture(amount: number): void {
    this.painter.paperTexture(amount);
  }
  debugBox(...args: [string, number, number, number, number]): void {
    this.painter.debugBox(...args);
  }
}
