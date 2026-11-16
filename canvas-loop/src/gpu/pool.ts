// GPU textures reused across a frame and between frames, keyed by format and
// size rounded up to 64 px. After the first frames of a steady scene no texture
// is created; `trim` drops what the last frame did not use, and `destroy`
// frees every texture the pool holds.

/** The texture formats the renderer uses: layers, clip masks, the coverage atlas. */
export type PoolFormat = "rgba8unorm" | "r8unorm" | "r32float" | "r16float";

const ALL_USES = 0x10 | 0x04 | 0x01 | 0x02; // RENDER_ATTACHMENT | TEXTURE_BINDING | COPY_SRC | COPY_DST

export class TexturePool {
  #device: GPUDevice;
  #free = new Map<string, GPUTexture[]>();
  #keys = new Map<GPUTexture, string>();
  // Textures handed out since the last `trim`.
  #used = new Set<GPUTexture>();
  created = 0;

  constructor(device: GPUDevice) {
    this.#device = device;
  }

  /** A texture at least `w` × `h`; its real size is `texture.width` × `texture.height`. */
  acquire(size: { w: number; h: number; format: PoolFormat }): GPUTexture {
    const cw = Math.max(64, Math.ceil(size.w / 64) * 64);
    const ch = Math.max(64, Math.ceil(size.h / 64) * 64);
    const key = `${size.format}:${cw}x${ch}`;
    const hit = this.#free.get(key)?.pop();
    if (hit !== undefined) {
      this.#used.add(hit);
      return hit;
    }
    this.created++;
    const texture = this.#device.createTexture({ size: [cw, ch], format: size.format, usage: ALL_USES });
    this.#keys.set(texture, key);
    this.#used.add(texture);
    return texture;
  }

  release(texture: GPUTexture): void {
    const key = this.#keys.get(texture);
    if (key === undefined) return;
    const list = this.#free.get(key) ?? [];
    list.push(texture);
    this.#free.set(key, list);
  }

  get count(): number {
    return this.#keys.size;
  }

  /** Bytes held, for the transcript. */
  get bytes(): number {
    let total = 0;
    for (const [t, key] of this.#keys) total += t.width * t.height * (key.startsWith("rgba8") || key.startsWith("r32") ? 4 : key.startsWith("r16") ? 2 : 1);
    return total;
  }

  /** Textures handed out and not yet released. */
  get inUse(): number {
    let free = 0;
    for (const list of this.#free.values()) free += list.length;
    return this.#keys.size - free;
  }

  /** After a frame, finished or failed: every texture is free again. */
  releaseAll(): void {
    this.#free.clear();
    for (const [t, key] of this.#keys) {
      const list = this.#free.get(key) ?? [];
      list.push(t);
      this.#free.set(key, list);
    }
  }

  /** After a frame: destroy free textures that frame did not use, so a scene that shrinks gives memory back. */
  trim(): void {
    for (const [key, list] of this.#free) {
      const keep = list.filter((t) => this.#used.has(t));
      for (const t of list) {
        if (keep.includes(t)) continue;
        t.destroy();
        this.#keys.delete(t);
      }
      this.#free.set(key, keep);
    }
    this.#used.clear();
  }

  destroy(): void {
    for (const t of this.#keys.keys()) t.destroy();
    this.#keys.clear();
    this.#free.clear();
  }
}
