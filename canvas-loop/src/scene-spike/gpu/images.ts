// `pixels` images on the GPU: one texture per version, premultiplied, uploaded
// when first drawn and kept while frames keep drawing it.
import type { PixelsVersion } from "../scene.js";

export class ImageCache {
  readonly #device: GPUDevice;
  readonly #tex = new Map<PixelsVersion, { tex: GPUTexture; frame: number }>();
  #frame = 0;

  constructor(device: GPUDevice) {
    this.#device = device;
  }

  /** After a frame: free the images it did not draw. */
  endFrame(): void {
    for (const [v, e] of this.#tex) {
      if (e.frame === this.#frame) continue;
      e.tex.destroy();
      this.#tex.delete(v);
    }
    this.#frame++;
  }

  get(version: PixelsVersion): GPUTexture {
    const hit = this.#tex.get(version);
    if (hit !== undefined) {
      hit.frame = this.#frame;
      return hit.tex;
    }
    const { width, height, data } = version;
    const pre = new Uint8Array(data.length);
    for (let i = 0; i + 3 < data.length; i += 4) {
      const a = data[i + 3] ?? 0;
      pre[i + 3] = a;
      for (let k = 0; k < 3; k++) pre[i + k] = Math.round(((data[i + k] ?? 0) * a) / 255);
    }
    const tex = this.#device.createTexture({ size: [width, height], format: "rgba8unorm", usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    this.#device.queue.writeTexture({ texture: tex }, pre, { bytesPerRow: width * 4 }, [width, height]);
    this.#tex.set(version, { tex, frame: this.#frame });
    return tex;
  }

  get count(): number {
    return this.#tex.size;
  }

  destroy(): void {
    for (const e of this.#tex.values()) e.tex.destroy();
    this.#tex.clear();
  }
}
