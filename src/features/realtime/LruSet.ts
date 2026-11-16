/** Bounded set that forgets the oldest keys first. Used for duplicate event-id detection. */
export class LruSet {
  private set = new Set<string>();
  constructor(private readonly capacity: number) {}

  /** Returns true if the key was already present. */
  checkAndAdd(key: string): boolean {
    if (this.set.has(key)) return true;
    this.set.add(key);
    if (this.set.size > this.capacity) {
      const oldest = this.set.values().next().value;
      if (oldest !== undefined) this.set.delete(oldest);
    }
    return false;
  }

  get size(): number {
    return this.set.size;
  }

  clear(): void {
    this.set.clear();
  }
}
