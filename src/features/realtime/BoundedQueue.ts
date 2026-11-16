/**
 * Fixed-capacity FIFO ring buffer. When full, the oldest item is evicted and
 * reported so the caller can count it as dropped. O(1) push/shift, no array copying.
 */
export class BoundedQueue<T> {
  private items: (T | undefined)[];
  private head = 0;
  private length = 0;

  constructor(readonly capacity: number) {
    if (capacity < 1) throw new Error('capacity must be >= 1');
    this.items = new Array(capacity);
  }

  get size(): number {
    return this.length;
  }

  /** Returns the evicted item when the queue was full, otherwise undefined. */
  push(item: T): T | undefined {
    let evicted: T | undefined;
    if (this.length === this.capacity) {
      evicted = this.items[this.head];
      this.items[this.head] = undefined;
      this.head = (this.head + 1) % this.capacity;
      this.length--;
    }
    this.items[(this.head + this.length) % this.capacity] = item;
    this.length++;
    return evicted;
  }

  /** Removes and returns up to `max` items in FIFO order. */
  drain(max: number): T[] {
    const n = Math.min(max, this.length);
    const out = new Array<T>(n);
    for (let i = 0; i < n; i++) {
      out[i] = this.items[this.head] as T;
      this.items[this.head] = undefined;
      this.head = (this.head + 1) % this.capacity;
    }
    this.length -= n;
    return out;
  }

  clear(): void {
    this.items = new Array(this.capacity);
    this.head = 0;
    this.length = 0;
  }
}
