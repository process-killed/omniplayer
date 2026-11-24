// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { appendInBatches, rafThrottle, yieldToMain } from '../src/utils/scheduling';

describe('scheduling helpers', () => {
  it('yields to the main thread', async () => {
    let ran = false;
    void yieldToMain().then(() => {
      ran = true;
    });
    // The promise resolves on a later task, never synchronously.
    expect(ran).toBe(false);
    await yieldToMain();
    expect(ran).toBe(true);
  });

  it('coalesces repeated calls into one frame', async () => {
    const spy = vi.fn();
    const throttled = rafThrottle(spy as unknown as (...args: never[]) => void);
    throttled(1 as never);
    throttled(2 as never);
    throttled(3 as never);
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    expect(spy).toHaveBeenCalledTimes(1);
    // The last arguments win.
    expect(spy).toHaveBeenCalledWith(3);
  });

  it('appends every node in batches', async () => {
    const host = document.createElement('div');
    const nodes = Array.from({ length: 20 }, (_, index) => {
      const node = document.createElement('span');
      node.textContent = String(index);
      return node;
    });
    await appendInBatches(host, nodes, 6);
    expect(host.children.length).toBe(20);
    expect(host.lastElementChild?.textContent).toBe('19');
  });
});
