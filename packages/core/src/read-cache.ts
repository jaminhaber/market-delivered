// Coalesce concurrent reads; begin the TTL when a successful read finishes.
export function cachedRead<T>(read: () => Promise<T>, ttlMs: number) {
  let cached: Promise<T> | undefined;
  let expiresAt = 0;
  return () => {
    if (cached && expiresAt > Date.now()) return cached;
    expiresAt = Infinity;
    cached = Promise.resolve()
      .then(read)
      .then(
        (value) => {
          expiresAt = Date.now() + ttlMs;
          return value;
        },
        (error: unknown) => {
          cached = undefined;
          throw error;
        },
      );
    return cached;
  };
}
