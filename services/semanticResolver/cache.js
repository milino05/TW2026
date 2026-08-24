class BoundedTtlCache {
  constructor({ maxEntries = 300, ttlMs = 120000 } = {}) {
    this.maxEntries = Math.max(1, Number(maxEntries) || 300);
    this.ttlMs = Math.max(1000, Number(ttlMs) || 120000);
    this.values = new Map();
    this.pending = new Map();
  }

  get(key) {
    const cached = this.values.get(key);
    if (!cached) return null;
    if (cached.expiresAt <= Date.now()) {
      this.values.delete(key);
      return null;
    }
    this.values.delete(key);
    this.values.set(key, cached);
    return cached.value;
  }

  set(key, value) {
    this.values.delete(key);
    this.values.set(key, { value, expiresAt: Date.now() + this.ttlMs });
    while (this.values.size > this.maxEntries) {
      this.values.delete(this.values.keys().next().value);
    }
    return value;
  }

  async coalesce(key, loader) {
    const cached = this.get(key);
    if (cached) return cached;
    if (this.pending.has(key)) return this.pending.get(key);

    const pending = Promise.resolve()
      .then(loader)
      .then((value) => this.set(key, value))
      .finally(() => this.pending.delete(key));
    this.pending.set(key, pending);
    return pending;
  }
}

module.exports = BoundedTtlCache;
