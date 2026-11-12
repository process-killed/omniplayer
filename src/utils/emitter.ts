/** Tiny typed event emitter. */

export type Listener<T> = (payload: T) => void;

export class Emitter<Events extends object> {
  private listeners = new Map<keyof Events, Set<Listener<never>>>();

  on<K extends keyof Events>(event: K, handler: Listener<Events[K]>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(handler as Listener<never>);
    return () => this.off(event, handler);
  }

  once<K extends keyof Events>(event: K, handler: Listener<Events[K]>): () => void {
    const off = this.on(event, (payload) => {
      off();
      handler(payload);
    });
    return off;
  }

  off<K extends keyof Events>(event: K, handler: Listener<Events[K]>): void {
    this.listeners.get(event)?.delete(handler as Listener<never>);
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const handler of Array.from(set)) {
      try {
        (handler as Listener<Events[K]>)(payload);
      } catch (err) {
        // A broken listener must never break playback.
        console.error('[emitter] listener failed', err);
      }
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}
