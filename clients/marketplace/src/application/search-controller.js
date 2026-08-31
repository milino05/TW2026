export class SearchController {
  constructor({ search, debounceMs = 250, onStateChange = null } = {}) {
    if (typeof search !== "function") throw new TypeError("SearchController requires search().");
    this.search = search;
    this.debounceMs = Math.max(0, Number(debounceMs) || 0);
    this.onStateChange = onStateChange;
    this.state = { query: "", loading: false, error: null, results: [], selected: null };
    this.timer = null;
    this.abortController = null;
    this.sequence = 0;
  }

  snapshot() { return { ...this.state, results: [...this.state.results] }; }
  emit() { this.onStateChange?.(this.snapshot()); }

  setQuery(query, { immediate = false } = {}) {
    this.state.query = String(query || "").trim();
    this.state.error = null;
    this.emit();
    clearTimeout(this.timer);
    this.timer = null;
    if (!this.state.query) {
      this.abortController?.abort();
      this.sequence += 1;
      this.state.loading = false;
      this.state.results = [];
      this.emit();
      return Promise.resolve(this.snapshot());
    }
    if (immediate || this.debounceMs === 0) return this.run();
    this.timer = window.setTimeout(() => {
      this.timer = null;
      void this.run();
    }, this.debounceMs);
    return Promise.resolve(this.snapshot());
  }

  async run() {
    const query = this.state.query;
    if (!query) return this.snapshot();
    this.abortController?.abort();
    const controller = new AbortController();
    this.abortController = controller;
    const sequence = ++this.sequence;
    this.state.loading = true;
    this.state.error = null;
    this.emit();
    try {
      const results = await this.search(query, { signal: controller.signal });
      if (sequence !== this.sequence || controller.signal.aborted) return this.snapshot();
      this.state.results = Array.isArray(results) ? results : [];
    } catch (error) {
      if (controller.signal.aborted || sequence !== this.sequence) return this.snapshot();
      this.state.error = error instanceof Error ? error.message : "Ricerca non riuscita";
      this.state.results = [];
    } finally {
      if (sequence === this.sequence && !controller.signal.aborted) {
        this.state.loading = false;
        this.emit();
      }
    }
    return this.snapshot();
  }

  retry() { return this.run(); }
  select(value) { this.state.selected = value ?? null; this.emit(); return this.snapshot(); }
  clearSelection() { return this.select(null); }

  dispose() {
    clearTimeout(this.timer);
    this.timer = null;
    this.abortController?.abort();
    this.sequence += 1;
  }
}
