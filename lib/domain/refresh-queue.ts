// Coalesce bursts and serialize requests so an older response cannot replace newer data.
export function createRefreshQueue(load: () => Promise<void>, delay = 500) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let active = false;
  let dirty = false;
  let disposed = false;
  const run = async () => {
    timer = undefined;
    if (disposed || active) return;
    active = true;
    dirty = false;
    try {
      await load();
    } finally {
      active = false;
      if (dirty && !disposed) timer = setTimeout(() => void run(), delay);
    }
  };
  return {
    request() {
      if (disposed) return;
      dirty = true;
      if (!active && !timer) timer = setTimeout(() => void run(), delay);
    },
    dispose() {
      disposed = true;
      if (timer) clearTimeout(timer);
    },
  };
}
