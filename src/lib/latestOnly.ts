/** Prevent a slow previous identity/request from restoring private state. */
export function latestOnly<T>(apply: (value: T) => void) {
  let version = 0;
  return {
    invalidate() {
      version++;
    },
    async run(load: () => Promise<T>) {
      const ticket = ++version;
      try {
        const value = await load();
        if (ticket === version) apply(value);
      } catch (error) {
        if (ticket === version) throw error;
      }
    },
  };
}
