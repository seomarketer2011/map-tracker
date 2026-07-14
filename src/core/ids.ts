/**
 * Small deterministic hashing helpers.
 *
 * Grid point IDs must be stable across runs so that today's scan lands on the
 * exact same coordinates as last month's. We derive IDs from grid identity +
 * row/col (square) or ring/index (radial) rather than random UUIDs.
 */

/** FNV-1a 32-bit — fast, deterministic, dependency-free. Not cryptographic. */
export function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Deterministic pseudo-random in [0, 1) from a string seed. */
export function hash01(seed: string): number {
  // Two rounds of FNV over the seed to fill 53 bits of mantissa-ish entropy.
  const a = parseInt(fnv1a(seed), 16);
  const b = parseInt(fnv1a("salt:" + seed), 16);
  return ((a * 4294967296 + b) % Number.MAX_SAFE_INTEGER) / Number.MAX_SAFE_INTEGER;
}
