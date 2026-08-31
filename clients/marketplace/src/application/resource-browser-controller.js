import { QueryState } from "./query-state.js";

export class ResourceBrowserController {
  constructor({ queryState = new QueryState(), load, onStateChange = null } = {}) {
    if (typeof load !== "function") throw new TypeError("ResourceBrowserController requires load().");
    this.query = queryState;
    this.load = load;
    this.onStateChange = onStateChange;
    this.state = { loading: false, error: null, items: [], total: 0 };
    this.sequence = 0;
  }

  snapshot() { return { ...this.state, items: [...this.state.items], query: this.query.snapshot() }; }
  emit() { this.onStateChange?.(this.snapshot()); }

  async refresh() {
    const sequence = ++this.sequence;
    this.state.loading = true;
    this.state.error = null;
    this.emit();
    try {
      const result = await this.load(this.query.snapshot());
      if (sequence !== this.sequence) return this.snapshot();
      this.state.items = Array.isArray(result?.items) ? result.items : [];
      this.state.total = Number(result?.total ?? this.state.items.length) || 0;
    } catch (error) {
      if (sequence !== this.sequence) return this.snapshot();
      this.state.error = error instanceof Error ? error.message : "Risorse non disponibili";
      this.state.items = [];
      this.state.total = 0;
    } finally {
      if (sequence === this.sequence) {
        this.state.loading = false;
        this.emit();
      }
    }
    return this.snapshot();
  }

  setQuery(value) { this.query.setQuery(value); return this.refresh(); }
  setFilter(key, value) { this.query.setFilter(key, value); return this.refresh(); }
  setSort(value) { this.query.setSort(value); return this.refresh(); }
  setPage(value) { this.query.setPage(value); return this.refresh(); }
  nextPage() { this.query.nextPage(); return this.refresh(); }
  previousPage() { this.query.previousPage(); return this.refresh(); }

  dispose() { this.sequence += 1; }
}
