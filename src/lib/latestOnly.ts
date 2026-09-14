/** Prevent a slow previous identity/request from restoring private state. */
export function latestOnly<T>(apply: (value: T) => void, onError?: () => void) {
  let version = 0;
  return {
    invalidate() {
      version++;
    },
    async run(load: (publish: (value: T) => void) => Promise<T>) {
      const ticket = ++version;
      const publish = (value: T) => {
        if (ticket === version) apply(value);
      };
      try {
        publish(await load(publish));
      } catch (error) {
        if (ticket === version) {
          onError?.();
          throw error;
        }
      }
    },
  };
}
