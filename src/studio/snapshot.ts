/**
 * A copy of anything the simulation is made of, deep enough to play on from
 * it without touching the original: objects keep their class (so their
 * methods still work), whatever is reached twice is copied once (so an object
 * and the one that points back at it stay together), and typed arrays, maps
 * and sets are copied with their contents. Functions are shared.
 *
 * The simulation has no other state and no random numbers of its own outside
 * its seeded generators, so a copy goes on exactly as the original would.
 */
export function snapshot<T>(root: T): T {
  const seen = new Map<object, unknown>();
  const copy = (value: unknown): unknown => {
    if (value === null || typeof value !== 'object') return value;
    const source = value as object;
    const done = seen.get(source);
    if (done !== undefined) return done;
    if (ArrayBuffer.isView(source)) {
      const out = (source as unknown as { slice(): unknown }).slice();
      seen.set(source, out);
      return out;
    }
    if (Array.isArray(source)) {
      const out: unknown[] = new Array(source.length);
      seen.set(source, out);
      for (let i = 0; i < source.length; i++) out[i] = copy(source[i]);
      return out;
    }
    if (source instanceof Map) {
      const out = new Map();
      seen.set(source, out);
      for (const [key, item] of source) out.set(copy(key), copy(item));
      return out;
    }
    if (source instanceof Set) {
      const out = new Set();
      seen.set(source, out);
      for (const item of source) out.add(copy(item));
      return out;
    }
    const out = Object.create(Object.getPrototypeOf(source)) as Record<string, unknown>;
    seen.set(source, out);
    for (const key of Object.keys(source)) out[key] = copy((source as Record<string, unknown>)[key]);
    return out;
  };
  return copy(root) as T;
}
