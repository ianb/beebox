# canvas-loop scene: prior art

Stage 0 note for `beebox/docs/implemented-plans/canvas-loop-scene.md`. Researched 2026-11-14 from primary
sources where possible. A claim marked **unverified** comes from a secondary source or from memory
and needs a check before a decision depends on it. Each item: what it is, what to borrow, what an
agent recognises, limits, source.

## 1. View as a value

### Elm: `view : Model -> Html Msg`

- **What it is.** The Elm Architecture: `init`, `update`, `view`. `view` returns a virtual DOM tree.
  The runtime compares it with the previous tree and patches the real DOM. `Html.Keyed` gives
  children a stable identity so reordering moves nodes instead of rebuilding them. `Html.Lazy` skips
  a subtree when its arguments are reference-equal.
- **Borrow.** canvas-loop already has `init`/`update`/`draw` (`canvas-loop/TEA.md`). The scene makes
  `draw` the same as Elm's `view`. `Html.Lazy` is the model for an explicit cache: a subtree
  recomputes only when its inputs change.
- **Agent recognises.** "TEA", pure view function, keyed lists, lazy.
- **Limits.** Comparison costs time every frame. Elm makes it cheap with reference equality on
  immutable data; JavaScript sketches mutate freely, so `lazy`-style skipping needs a stated
  equality rule.
- **Source.** https://guide.elm-lang.org/architecture/ ;
  https://package.elm-lang.org/packages/elm/html/latest/Html-Keyed

### React: elements, keys, reconciliation

- **What it is.** A component returns elements (plain objects: type, props, children).
  Reconciliation matches the new tree to the old one by position and type. A `key` overrides
  position. Same type and key at a position keeps state; a different type or key resets it.
  `React.memo` skips a component when its props are shallow-equal.
- **Borrow.** The identity rule: automatic by position, explicit `key` to override (the plan's
  lean). Also: a component is a function that returns a subtree, which is the reuse unit for
  principle 3.
- **Agent recognises.** JSX, `key`, `memo`, "components". The most familiar model of all items here.
- **Limits.** The "missing key" warning exists because agents and people forget keys in lists.
  Positional identity gives wrong identity when an element appears conditionally before others.
  React-three-fiber and react-konva show that a React-shaped renderer for graphics works, but each
  adds a reconciler layer and allocation per frame.
- **Source.** https://react.dev/learn/preserving-and-resetting-state

### SwiftUI: views and `Canvas`

- **What it is.** `View` structs with a `body` that returns other views. Identity is structural
  (position in the code) or explicit (`.id()`, `ForEach` with `Identifiable`). `Canvas { context,
  size in ... }` is an immediate-mode drawing view inside the retained tree. `GraphicsContext` has
  `drawLayer`, per-layer `opacity`, `blendMode`, `addFilter` (blur, shadow, colour matrix),
  `clip(to:)`. `.drawingGroup()` flattens a subtree into one offscreen Metal-rendered image.
- **Borrow.** Two ideas. (1) Modifiers that read as a chain on a value (`.opacity(0.5).blur(radius:
  4)`), each one a wrapping group. (2) An immediate island inside a retained tree, which is a
  possible home for per-pixel fields if the scene ever needs one.
- **Agent recognises.** Modifier chains; `drawingGroup`.
- **Limits.** Modifier order changes the result (`.padding().background()` differs from the
  reverse). Agents get this wrong often (**unverified** general observation). Order rules must be
  explicit.
- **Source.** https://developer.apple.com/documentation/swiftui/canvas ;
  https://developer.apple.com/documentation/swiftui/graphicscontext

### Flutter: widget, element, render object, layer

- **What it is.** Four trees. Widgets are immutable descriptions, rebuilt freely. Elements hold
  identity and state, matched by type and `Key` (like React). Render objects do layout and paint.
  Painting records into pictures inside a layer tree. `RepaintBoundary` makes a subtree paint into
  its own layer, so a change elsewhere does not repaint it, and the engine may raster-cache that
  layer. The Skia-era engine caches a picture after it was drawn unchanged for a few frames and is
  "complex" enough (`flow/raster_cache.cc`, `DisplayListRasterCacheItem`).
- **Borrow.** The split between description (cheap, rebuilt) and retained render state (expensive,
  kept by identity). Automatic raster caching driven by "unchanged for N frames and costly to draw"
  heuristics. A boundary as a hint, not a requirement.
- **Agent recognises.** `RepaintBoundary`, `Key`, `CustomPainter` (`paint(Canvas, Size)` plus
  `shouldRepaint`).
- **Limits.** Each boundary costs a texture. A boundary around content that changes every frame
  thrashes the cache. Under Impeller (now the default engine) the raster cache is not used the same
  way; **unverified** whether Impeller raster-caches at all. Four trees are too many concepts for
  canvas-loop; the scene needs two (description and renderer state).
- **Source.** https://docs.flutter.dev/resources/architectural-overview ;
  https://api.flutter.dev/flutter/widgets/RepaintBoundary-class.html ;
  https://flutter.googlesource.com/mirrors/engine/+/refs/tags/3.13.1/flow/layers/display_list_raster_cache_item.h

## 2. Record and replay

### Skia `SkPicture` / `SkPictureRecorder`

- **What it is.** `SkPictureRecorder::beginRecording(bounds)` returns an `SkCanvas`. Calls on it are
  stored, not drawn. `finishRecordingAsPicture()` returns an immutable `SkPicture` that can be
  replayed on any canvas, serialized, or turned into an image (`SkImage::MakeFromPicture`) or shader
  (`SkPicture::makeShader`).
- **Borrow.** canvas-loop headless already runs on Skia (via `@napi-rs/canvas`). A keyed subtree can
  map to a picture: record once, replay while its key and inputs stay equal. The `v.*` builder can
  record into scene nodes the same way a recorder records into ops, which answers the plan's
  "returned value or builder" question with "builder that records".
- **Agent recognises.** The pattern ("display list", `Path2D`), rarely the name.
- **Limits.** A picture is a list of ops, not a tree with identity. It has no partial invalidation.
  Effects that read the backdrop (smear) force a replay order. `@napi-rs/canvas` does not expose
  `SkPicture` to JavaScript (**unverified**; the canvas-loop painter does not use it today).
- **Source.** https://api.skia.org/classSkPicture.html ;
  https://api.skia.org/classSkPictureRecorder.html

### Chrome display lists and paint ops

- **What it is.** Blink paints the layout tree into paint chunks of `cc::PaintOp` records (a
  `PaintOpBuffer`). Chunks carry property tree state (transform, clip, effect). The compositor
  rasterizes chunks into tiles and only re-rasterizes invalidated regions. Effects (opacity, filter,
  blend) live in a separate effect tree, not in the ops.
- **Borrow.** Separate the "what to draw" ops from the "how to composite" properties. A scene
  group's transform, clip, opacity, blend and effects are property-tree state; the shapes inside are
  ops. This split makes caching safe: changing a group's opacity does not invalidate its contents.
- **Agent recognises.** CSS: `opacity`, `filter`, `mix-blend-mode`, `isolation: isolate`,
  `will-change: transform` (which promotes to a layer). This is the vocabulary agents know best for
  effects on a group.
- **Limits.** Not a library. The design is large; only the idea transfers.
- **Flutter `DisplayList`** is the same idea in Flutter: a compact op buffer built by
  `DisplayListBuilder`, with bounds and a complexity score, replayed on Skia or Impeller. It is a
  renderer-neutral recorded form that two backends consume, which is the canvas-loop need.
- **Source.** https://developer.chrome.com/docs/chromium/renderingng-data-structures ;
  https://codebrowser.dev/flutter_engine/flutter_engine/flutter/flow/layers/display_list_raster_cache_item.h.html


## 3. 2D scene graph libraries agents know

| Library | Effect on one object | Cache | Mask / clip |
|---|---|---|---|
| PixiJS v8 | `container.filters = [new BlurFilter()]` | `container.cacheAsTexture(true)`, `updateCacheTexture()` | `container.mask = graphics` or sprite |
| Konva | `node.cache(); node.filters([Konva.Filters.Blur]); node.blurRadius(10)` | `node.cache()` | `clipFunc`, `globalCompositeOperation` |
| Paper.js | `item.blendMode`, `item.opacity`; no filters | `item.rasterize()` | `Group` with `clipped = true` |
| Two.js | none | none | `group.mask = shape` |
| Fabric.js | `image.filters.push(...)`; `applyFilters()` (images only) | `objectCaching` (on by default) | `clipPath` object |

### PixiJS v8

- **What it is.** The most used WebGL 2D library. v8 (2024) has WebGL2 and WebGPU backends behind
  one API. Scene: `Container`, `Sprite`, `Graphics`, `Text`, `Mesh`. Filters on any container.
  `RenderTexture` and `renderer.render({ container, target })` render a subtree to a texture. Render
  groups move a subtree's transform work to the GPU.
- **Borrow.** Filter on a container means "render the container's bounds plus padding to a texture,
  run the filter, composite back". Caching uses the same texture mechanism. So one mechanism serves
  effects and caching, which the plan wants (today three mechanisms). Instanced batching of sprites
  is the model for GPU dabs.
- **Agent recognises.** Strongly: `new Container()`, `addChild`, `filters`, `mask`,
  `cacheAsTexture`. Pixi's API is the most likely shape an agent writes for a "2D scene on the GPU".
- **Limits.** The v8 guide says filters "may not behave as expected" with `cacheAsTexture`, and
  suggests wrapping in a parent. Textures over about 4096×4096 may fail to cache. Filters with
  several passes (blur) cost a lot. Path antialiasing in `Graphics` relies on MSAA or the canvas
  `antialias` flag, so thin strokes look different from Skia (**unverified** for v8). Not
  deterministic headless.
- **Source.** https://pixijs.com/8.x/guides/components/scene-objects/container/cache-as-texture ;
  https://pixijs.com/blog/pixi-v8-launches

### Konva, Paper.js, Two.js, Fabric.js

- **Konva.** Canvas2D scene graph (`Stage`, `Layer`, `Group`, shapes). A filter needs `node.cache()`
  first, because filters run on CPU pixels of a cached bitmap; agents copying it forget `cache()` or
  the re-cache after a change (**unverified** observation). https://konvajs.org/docs/filters/Blur.html
- **Paper.js.** Retained vector items with a rich path API (boolean ops, `smooth()`, `simplify()`),
  `Group.clipped` for clips, `rasterize()` for caching. Agents know its path API; canvas-loop's path
  forms are close. http://paperjs.org/reference/item/
- **Two.js.** One scene API over SVG, Canvas2D and WebGL renderers. It shows the "same scene,
  several renderers" idea at small scale; the WebGL renderer rasterizes each shape on a 2D canvas
  and uploads it as a texture (**unverified** for the current version). https://two.js.org/docs/two/
- **Fabric.js.** Object model for editors, with per-object `objectCaching` on by default and filters
  for images only (WebGL filter backend for images). Shows automatic per-object caching keyed on
  "dirty" flags. https://fabricjs.com/docs/

## 4. GPU 2D vector renderers

### How antialiased path fill works on the GPU

- **Stencil-and-cover.** Draw a triangle fan of the path into the stencil buffer (winding count),
  then draw a cover quad where stencil is non-zero. Simple, exact winding, any path. Antialiasing
  needs MSAA. Used by NanoVG, NV_path_rendering, early Skia GPU paths.
- **Tessellation + MSAA.** Triangulate on the CPU (Pixi `Graphics`, libtess), draw with 4× or 8×
  MSAA. MSAA gives only 4–8 coverage levels, so edges look stepped next to Skia's analytic coverage.
- **Analytic coverage.** Compute per-pixel area coverage from edges. Vello (in compute shaders, or
  CPU tiling with "sparse strips" in Vello GPU), Pathfinder (tiles on CPU, coverage on GPU), Skia
  CPU, Rive (pixel local storage accumulates coverage in a single pass). Gives Skia-quality edges.
- **SDF.** Store distance to the edge in a texture; threshold with a smooth step. Mapbox/MapLibre
  use SDF glyphs and icons for text at any scale. Good for text, outlines, glows, bevels; poor for
  arbitrary paths that change every frame.
- **For canvas-loop.** Most marks are brush dabs (textured quads), not big vector fills. Dabs need
  instanced quads, not path coverage. Path fill quality matters for ink lines, fills and text.

### Skia CanvasKit

- **What it is.** Skia compiled to WebAssembly, with a WebGL2 surface (Ganesh backend) or a CPU
  raster surface. npm `canvaskit-wasm`, latest 0.42.0 (2026-08-18). Flutter web uses it.
- **Size (measured here).** `bin/canvaskit.wasm` 0.42.0 is 7.3 MB raw, 2.9 MB gzip. The `full` build
  is 8.2 MB raw, 3.3 MB gzip.
- **WebGPU.** The changelog added `MakeGPUDeviceContext` and related functions in 0.35.0 (2022).
  Forum posts in 2026 say no WebGPU build ships in the npm package and Graphite for WebAssembly has
  no official support. Treat CanvasKit as WebGL2-only today.
- **CSP.** Compiling WebAssembly under `script-src 'self'` fails; it needs `'wasm-unsafe-eval'`,
  which permits WebAssembly compilation only, not `eval()`. beebox production uses `script-src
  'self'` (`beebox/src/lib/csp.ts:60-63`); development allows `'unsafe-eval'`, which also permits
  WebAssembly. So CanvasKit would work in development and fail in production. A WebKit bug report
  describes Safari rejecting WebAssembly even with `'wasm-unsafe-eval'` in some cases
  (**unverified** whether still open).
- **Borrow.** The same engine in browser and headless. CanvasKit's CPU raster surface also runs in
  Node, so one WebAssembly Skia could be the reference in both places (WebAssembly arithmetic is
  deterministic apart from NaN bits; GPU surfaces differ). Its API mirrors Canvas2D and Skia
  (`Paint`, `Path`, `ImageFilter`, `Shader`, `RuntimeEffect` for SkSL shaders).
- **Agent recognises.** Skia types; Canvas2D-like calls.
- **Limits.** ~3 MB download per page with figures (cached after first). Every object needs
  `delete()`: manual memory management in JavaScript. Custom shaders are SkSL, not WGSL or GLSL. No
  compute.
- **Source.** https://skia.org/docs/user/modules/canvaskit/ ;
  https://skia.googlesource.com/skia/+/refs/heads/main/modules/canvaskit/CHANGELOG.md ;
  https://developer.mozilla.org/docs/Web/HTTP/Headers/Content-Security-Policy/script-src

### Vello (Linebender)

- **What it is.** A Rust 2D renderer. Three renderers now share the "sparse strips" design: Vello
  CPU (most mature), Vello GPU (formerly `vello_hybrid`: CPU tiles, GPU rasterizes and composites,
  WebGL2 backend and wgpu backend without compute) and the original compute renderer, now under
  `research/` and described as experimental.
- **Borrow.** Analytic-coverage quality on WebGL2 without compute. The CPU/GPU pair from one code
  base is the same "reference + fast" shape as canvas-loop's plan.
- **Agent recognises.** Nothing at the JavaScript level.
- **Limits.** No JavaScript bindings; we would compile Rust to WebAssembly ourselves (same CSP
  need). Crates are 0.x; `vello_hybrid` 0.0.6 (2026-01). Brush, filter and blur support
  **unverified**.
- **Source.** https://github.com/linebender/vello ; https://docs.rs/vello_gpu

### Rive renderer

- **What it is.** Rive's open-source (MIT) C++ renderer. Uses pixel local storage (or fragment
  shader interlock) to fill and blend paths in one pass with analytic antialiasing. Web package
  `@rive-app/webgl2`. Without the draft `WEBGL_shader_pixel_local_storage` extension it falls back
  to an MSAA WebGL2 path. A WebGPU port exists (**unverified** maturity).
- **Borrow.** The technique (coverage and blend in one pass, no intermediate textures) for the
  blend-heavy, overlapping-dab case.
- **Agent recognises.** Rive as an animation tool, not as an API.
- **Limits.** Built to play `.riv` files; using it as a general renderer means C++ and WebAssembly.
  Best path depends on a draft extension.
- **Source.** https://rive.app/docs/runtimes/web/canvas-vs-webgl ; https://rive.app/renderer

### ThorVG

- **What it is.** Small C++ vector engine (SVG, Lottie). 1.0 released 2026-01-30 with
  `@thorvg/webcanvas`: TypeScript over WebAssembly with software, WebGL and WebGPU backends. A
  ThorVG talk gives about 988 KB for the WebGPU WebAssembly build.
- **Borrow.** Proof that a WebGPU 2D path in under 1 MB of WebAssembly ships in 2026.
- **Limits.** Same CSP need. Scene API is SVG-like; no brush model. Browser floor (Chrome 113,
  Firefox 141, Safari 26) from a mirrored README (**unverified**).
- **Source.** https://www.thorvg.org/post/thorvg-v1-0-a-new-generation-released ;
  https://github.com/thorvg/thorvg.web

### Mapbox GL / MapLibre GL

- **Techniques.** CPU tessellation of fills (earcut), extruded line geometry with antialiasing done
  in the fragment shader from the distance to the line centre, SDF glyph atlases for text, per-tile
  vertex buffers kept while the tile is visible, instanced symbols.
- **Borrow.** Lines as extruded quads with shader antialiasing: a cheap, good-looking way to draw
  ink strokes and hatching on WebGL2 without MSAA. SDF text for labels at any zoom.
- **Source.** https://github.com/maplibre/maplibre-gl-js

### Maturity in the browser today

| Renderer | Runs in browser | Backend | Needs WebAssembly | Maturity |
|---|---|---|---|---|
| Canvas2D (Chrome uses Skia Graphite) | yes | browser | no | production |
| PixiJS v8 | yes | WebGL2, WebGPU | no | production |
| CanvasKit | yes | WebGL2, CPU | yes | production (Flutter web) |
| Rive renderer | yes | WebGL2 (+ PLS ext) | yes | production for `.riv` |
| ThorVG webcanvas | yes | SW, WebGL, WebGPU | yes | 1.0, new |
| Vello GPU | yes, via own build | WebGL2, wgpu | yes | 0.x |
| Pathfinder (servo/pathfinder) | old demos | WebGL2 | yes | unmaintained since about 2021 (**unverified**) |
| Own WebGL2 (MapLibre-style) | yes | WebGL2 | no | what we write |

## 5. WebGPU and WebGL2 availability (2026)

### Browsers

- **WebGL2.** Available in every current browser, including Safari since 15 (2021). The safe
  baseline.
- **WebGPU, Chrome/Edge.** On by default on Windows, macOS, ChromeOS since 113; Android 12+
  (Qualcomm and ARM GPUs) since 121; Linux rollout started around 144 (**unverified** completion).
- **WebGPU, Safari.** On by default in Safari 26 on macOS Tahoe 26, iOS 26, iPadOS 26, visionOS 26.
  A WebKit report says Safari 26 on macOS 15 has it off. Devices that cannot run iOS 26 have no
  WebGPU.
- **WebGPU, Firefox.** Windows since 141 (2025-07); macOS on Apple Silicon since 145–147. Linux,
  Android and Intel Macs not on by default as of 2026-08 (secondary source). Firefox on iOS uses
  WebKit, so it follows Safari.
- **Consequence.** WebGPU covers most users but not all. A WebGPU-only renderer needs a fallback
  (WebGL2 or Canvas2D) for Firefox on Linux and Android, older iPhones, and Intel Macs in Firefox.
- **Source.** https://web.dev/blog/webgpu-supported-major-browsers ; https://caniuse.com/webgpu

### Headless and Node

- **WebGL2 headless.** Still no good path, which matches the 2026-07 finding
  (`issues/closed/exploration/2026-07-13-canvas-tight-loop-agent-programming.md:90`). `headless-gl`
  is WebGL1 only (**unverified** for 2026). A headless browser (Puppeteer) works but is not
  "browser-less".
- **WebGPU in Node.** The `webgpu` npm package (from `github.com/dawn-gpu/node-webgpu`) ships
  prebuilt Dawn (`dawn.node`) for Windows, macOS (Intel and Arm) and Linux, Node 18+. It renders to
  textures and reads them back; no window. It can use a software Vulkan (lavapipe; also SwiftShader
  in Dawn) on machines without a GPU. Small project (about 120 stars); bugs go to the Dawn tracker.
- **Deno** ships WebGPU on wgpu (https://docs.deno.com/api/web/gpu).
- **Determinism.** Same adapter, same driver, same shaders give the same bytes in practice, and a
  software adapter removes the driver variable. No source guarantees it; WGSL allows implementation
  latitude in float precision. A deterministic headless GPU path is **possible but unproven**. It
  would let the browser's effect and lighting shaders run headless. A Stage 3 probe can test
  byte-identical repeat runs on SwiftShader or lavapipe.
- **Source.** https://github.com/dawn-gpu/node-webgpu ;
  https://dawn.googlesource.com/dawn/+/refs/heads/main/src/dawn/node/README.md

## 6. Painterly and NPR techniques on the GPU

### Stamp (dab) brush engines

- **What it is.** A stroke is a sequence of dabs: a textured, rotated, scaled quad placed along the
  path at a spacing, with pressure and jitter. Krita and Procreate (shape plus grain textures, "wet
  edges", "glazed" blending) work this way. On the GPU each dab is one instance: per-instance
  position, size, angle, colour, opacity, texture index.
- **Borrow.** canvas-loop's stamp presets and soft dabs map one to one onto instanced quads in one
  draw call per brush and blend mode. Grain sampled in paper space (not dab space) keeps texture
  still while the dab moves. The current Skia renderer already moved to "one soft-dab image" (commit
  `2e0720f1a`), which is the same data shape.
- **Limits.** Dabs that read and smear the canvas (canvas-loop's smear,
  `src/core/brush/render/smear.ts:114`) need the evolving backdrop: ping-pong textures or one draw
  per dab, which is slow. Procreate-style "wet mix" has the same cost. Blend order within one stroke
  must match Skia's.
- **Source.** https://docs.krita.org/en/reference_manual/brushes/brush_engines.html ;
  https://help.procreate.com/procreate/handbook/brushes/brush-studio-settings

### Watercolour

- **Curtis et al. 1997.** Physical simulation: shallow-water fluid layer, pigment deposition and
  lifting, paper height field, edge darkening from flow toward the wet edge, backruns, glazing by
  Kubelka–Munk compositing. Too slow for animation in full, but it names the visual effects.
  https://grail.cs.washington.edu/projects/watercolor/
- **Bousseau et al. 2006.** Real-time image-space watercolour: from a rendered image, apply (1)
  pigment density variation from noise, (2) paper texture modulation, (3) edge darkening from the
  image gradient, (4) abstraction (morphological smoothing). A colour-modification formula darkens
  or lightens by a density value. All are full-screen shader passes; it maps directly onto a "wash"
  effect on a group. https://hal.inria.fr/inria-00510245 (Interactive watercolor rendering with
  temporal coherence and abstraction, NPAR 2006)
- **Borrow.** Bousseau's passes as the GPU "wash" effect: density noise, paper modulation, edge
  darkening, granulation (pigment settling into paper valleys: multiply by a function of paper
  height). Each is one fragment pass over the group's texture. Paper height also modulates dab alpha
  (dry brush). Edge darkening is the group's alpha minus a blurred copy: one blur, one combine pass.

### Hatching

- **Praun et al. 2001, "Real-time hatching".** Tonal art maps: a set of hatch textures by tone, each
  one including the strokes of lighter tones, with mipmaps that keep stroke width constant on
  screen. The shader blends the two nearest tones per pixel. Light gives tone, so hatching follows
  lighting. https://hhoppe.com/proj/hatching/
- **Borrow.** A "hatching" effect driven by luminance or by the light pass: sample a tonal art map
  in paper space. For 2D, the canvas-loop hatching brush (strokes as one mark) already exists; tonal
  art maps add "hatch by tone" over any filled region cheaply.
- **Limits.** Texture hatching looks uniform; canvas-loop's drawn hatching follows form. Both may
  be needed.

### Kuwahara and abstraction filters

- Edge-preserving smoothing; the anisotropic version (Kyprianidis et al. 2009) follows a structure
  tensor and looks like brush strokes, in a few real-time passes. A cheap "painterly" group effect
  that agents know from shader tutorials; on whole frames it reads as a photo filter, the look
  principle 2 warns against. https://www.kyprianidis.com/p/pg2009/

### Temporal coherence (the "shower door")

- **Problem.** Texture fixed to the screen while objects move looks like a pattern on glass in front
  of the scene.
- **Approaches.** (1) Texture in object space: attach paper or grain to the group's coordinate
  frame, so it moves with the object. (2) Dynamic textures that scale and blend octaves to keep a
  constant screen-space frequency while zooming (Bénard et al., "Dynamic solid textures", 2009). (3)
  Stroke-based: dabs anchored to object points; seeds from object-space parameters, not device
  pixels. (4) For a still page, screen space is correct: real paper does not move.
- **Borrow.** Let the scene say which frame a texture belongs to (page, group, or object). Seed
  brush randomness from object-space geometry; today seeds depend on device-space geometry
  (`canvas-loop/src/core/brush/render/mark.ts:94`), which causes texture to change with pixel ratio
  and transform.
- **Source.** Bénard et al., temporal coherence survey (2011), https://hal.inria.fr/hal-00715568

## 7. 2D lighting in games

### Normal-mapped sprites

- **What it is.** Each sprite has a colour texture and a normal map. A light at a 2D position plus a
  height gives a 3D light vector; the shader does Lambert (and optional Blinn–Phong specular) per
  pixel.
- **Sprite Lamp** makes normal maps from 2–5 hand-painted lighting drawings (lit from left, right,
  top, bottom). Its point: lighting can keep a hand-drawn character.
  http://www.snakehillgames.com/spritelamp/
- **Auto-generated normals from shapes.** For vector shapes, compute normals from the signed
  distance to the outline: inside a bevel width, the normal tilts away from the edge; in the middle,
  it faces the viewer ("pillow" or "dome" profile). A distance transform (jump flooding on the GPU)
  or an analytic SDF gives this. canvas-loop can generate these for any shape, so an agent writes
  `material: { bevel: 6, shine: 0.3 }` instead of painting normal maps.

### Shadow casting

- **Occluder polygons.** Godot `LightOccluder2D`, Unity `ShadowCaster2D`: a polygon per caster.
  Shadows are the polygon's edges extruded away from the light, or a per-light shadow map.
- **1D shadow map.** For each light, render occluders in polar coordinates into a 1-pixel-high
  texture of distances (one texel per angle); then each pixel compares its distance to the stored
  one. Soft edges by sampling several angles. Godot 4 also builds a 2D SDF from occluders for
  shader effects. Godot uses a per-light shadow buffer of this kind
  (**unverified** exact form in Godot 4).
  https://github.com/mattdesl/lwjgl-basics/wiki/2D-Pixel-Perfect-Shadows

### Deferred 2D lighting

- Render colour and normals to textures; each light draws its area and accumulates into a light
  texture; one pass combines. Cost per light follows its screen area, not the sprite count. A lit
  group maps onto this; hatching by tone (section 6) can read the light texture.

### How engines express it (API shape)

- **Godot 4.** Nodes: `PointLight2D` (texture, `energy`, `color`, `height`, `blend_mode`
  add/subtract/mix, `range_item_cull_mask`), `DirectionalLight2D`, `LightOccluder2D` (polygon,
  `occluder_light_mask`), `CanvasModulate` (ambient colour). Materials: `CanvasTexture` with
  diffuse, normal and specular (colour, shininess). Shadow filter none/PCF5/PCF13.
  https://docs.godotengine.org/en/stable/tutorials/2d/2d_lights_and_shadows.html
- **Unity URP 2D.** `Light2D` (Global, Spot, Freeform, Sprite), `ShadowCaster2D`, normal maps as
  sprite secondary textures, "Light Blend Styles".
  https://docs.unity3d.com/Packages/com.unity.render-pipelines.universal@17.0/manual/Lights-2D-intro.html
- **Agent recognises.** Lights as nodes in the tree, a cull mask or layer per light, ambient as a
  separate setting, materials on sprites. Godot's names are open source and documented; they are the
  safest to rhyme with.
- **Limits.** Without ambient, lights only brighten (Godot docs say this directly), which surprises
  authors. Directional 2D shadows are infinitely long in Godot. Shadows only appear inside a light's
  area. Every light adds a pass, so many lights need a cap or a tiled approach.

## 8. What this means for canvas-loop

### Backend candidates to shortlist

- **Own WebGL2 renderer (Pixi/MapLibre-style).** Runs everywhere, no WebAssembly, no CSP change.
  Dabs are instanced quads; lines are extruded quads with shader antialiasing; fills are
  tessellated. Highest build cost; edge quality below Skia unless we add analytic coverage.
- **Own renderer on WebGPU with WebGL2 fallback.** Compute for washes, SDF normals (jump flooding)
  and blur. Covers most users; fallback still needed. Possible headless runs through Dawn in Node.
- **CanvasKit (WebGL2).** Same Skia as headless; lowest parity risk for paths, text and blends.
  Costs about 3 MB gzip and `'wasm-unsafe-eval'` in production (human decision). Custom effects in
  SkSL. No WebGPU build.
- **PixiJS v8 as the browser renderer.** Mature WebGL2/WebGPU scene graph with filters and render
  textures. We would map scene to Pixi nodes. Its path antialiasing and filter/cache interaction
  need a probe.
- Not shortlisted: Vello (no JavaScript bindings, 0.x), Rive (built for `.riv`, best path behind a
  draft extension), Pathfinder (unmaintained), ThorVG (no brush model; useful only as evidence of
  WebGPU maturity).

### API styles to rhyme with

- **React/Elm** for the tree: components are functions returning subtrees; identity by position with
  explicit `key`; `memo`/`lazy` for explicit caching.
- **CSS / Canvas2D** for group compositing: `opacity`, `filter` (`blur()`, `drop-shadow()`),
  `mix-blend-mode`, `isolation`, `clip-path`, `mask`. Agents know these names best.
- **PixiJS** for effects on a container (`filters: [...]`) and for caching naming
  (`cacheAsTexture`), if caching stays explicit at all.
- **Godot 2D** for lights: `PointLight2D`-like nodes with `energy`, `color`, `height`, an ambient
  (`CanvasModulate`), occluders, and materials with normal and specular.
- **Flutter `RepaintBoundary`** as the model for automatic caching with an optional hint.

### The three facts most likely to change the design

1. **CanvasKit costs about 3 MB gzip and needs `'wasm-unsafe-eval'` in the production CSP, and it
   has no WebGPU build.** Development allows `'unsafe-eval'`, so it would pass in development and
   fail in production. If the CSP stays, every WebAssembly renderer is out and the browser renderer
   is our own JavaScript on WebGL2/WebGPU (or Pixi).
2. **WebGPU is not universal in 2026.** Firefox on Linux and Android, iPhones below iOS 26 and some
   Intel Macs lack it. A WebGPU renderer needs a WebGL2 (or Canvas2D) fallback, so effects designed
   on compute shaders need a fragment-shader version, or a stated reduced look.
3. **Dawn runs WebGPU in Node (`webgpu` npm), with software adapters.** If a Stage 3 probe shows
   byte-identical repeat renders, effect and lighting shaders can run headless as the same code as
   the browser. Then Skia draws paths and dabs and a shared GPU pass does washes, lighting and
   filters, which narrows the parity gap. If not, every GPU effect needs a second Skia
   implementation.
