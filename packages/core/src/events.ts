// EventEmitter — cross-renderer communication hub.
// Renderers emit events here; other renderers subscribe.
// No direct renderer-to-renderer dependencies.

export type EventCallback = (...args: unknown[]) => void;

export interface EventEmitter {
  on(event: string, callback: EventCallback): void;
  off(event: string, callback: EventCallback): void;
  emit(event: string, ...args: unknown[]): void;
  /** Remove all listeners for a specific event */
  removeAllListeners(event?: string): void;
}

/**
 * Create a new EventEmitter instance.
 */
export function createEventEmitter(): EventEmitter {
  return new EventEmitterImpl();
}

class EventEmitterImpl implements EventEmitter {
  private listeners = new Map<string, Set<EventCallback>>();

  on(event: string, callback: EventCallback): void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(callback);
  }

  off(event: string, callback: EventCallback): void {
    const set = this.listeners.get(event);
    if (set) {
      set.delete(callback);
      if (set.size === 0) {
        this.listeners.delete(event);
      }
    }
  }

  emit(event: string, ...args: unknown[]): void {
    const set = this.listeners.get(event);
    if (set) {
      for (const cb of set) {
        cb(...args);
      }
    }
  }

  removeAllListeners(event?: string): void {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }
}
