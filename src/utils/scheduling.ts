/**
 * Long-task splitting.
 *
 * INP is measured from a tap to the next paint. Anything that blocks the main
 * thread for 200 ms inside a click handler shows up as a poor score, so heavy
 * rendering is broken into chunks and handed back to the browser between them.
 */

type SchedulerLike = { yield?: () => Promise<void> };

const scheduler = (globalThis as unknown as { scheduler?: SchedulerLike }).scheduler;

/** Give the browser a chance to paint. Uses scheduler.yield when available. */
export function yieldToMain(): Promise<void> {
  if (scheduler?.yield) return scheduler.yield();
  return new Promise((resolve) => {
    // A macrotask is enough to let input and paint through; rAF is not, because
    // it can be starved by pending input in the same frame.
    setTimeout(resolve, 0);
  });
}

/** Run `fn` when the browser is idle, falling back to a timeout. */
export function whenIdle(fn: () => void, timeout = 2000): void {
  const idle = (globalThis as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void })
    .requestIdleCallback;
  if (idle) idle(fn, { timeout });
  else setTimeout(fn, 1);
}

/** Coalesce repeated calls into one per animation frame. */
export function rafThrottle<T extends (...args: never[]) => void>(fn: T): T {
  let scheduled = false;
  let lastArgs: unknown[] = [];
  const wrapped = (...args: unknown[]) => {
    lastArgs = args;
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      (fn as unknown as (...a: unknown[]) => void)(...lastArgs);
    });
  };
  return wrapped as unknown as T;
}

/**
 * Append children in batches, yielding between them.
 *
 * A settings page with 40 cards builds in ~4 ms per batch instead of one 60 ms
 * block, so a tap that lands mid-render is not stuck behind all of it.
 */
export async function appendInBatches(
  host: HTMLElement,
  nodes: HTMLElement[],
  batchSize = 8,
): Promise<void> {
  for (let index = 0; index < nodes.length; index += batchSize) {
    const fragment = document.createDocumentFragment();
    for (const node of nodes.slice(index, index + batchSize)) fragment.append(node);
    host.append(fragment);
    if (index + batchSize < nodes.length) await yieldToMain();
  }
}
