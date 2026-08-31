function defaultGetResults(result) {
  if (Array.isArray(result)) return result;
  return Array.isArray(result?.results) ? result.results : [];
}

export class SearchController {
  constructor({ search, getResults = defaultGetResults, debounceMs = 250, allowEmptyQuery = false, onStateChange = null } = {}) {
    if (typeof search !== "function") throw new TypeError("SearchController requires search().");
    if (typeof getResults !== "function") throw new TypeError("SearchController getResults must be a function.");
    this.search = search;
    this.getResults = getResults;
    this.debounceMs = Math.max(0, Number(debounceMs) || 0);
    this.allowEmptyQuery = Boolean(allowEmptyQuery);
    this.onStateChange = onStateChange;
    this.state = { query: "", loading: false, error: null, results: [], result: null, selected: null };
    this.timer = null;
    this.abortController = null;
    this.sequence = 0;
  }

  snapshot() { return { ...this.state, results: [...this.state.results] }; }
  emit() { this.onStateChange?.(this.snapshot()); }

  cancelScheduled() {
    clearTimeout(this.timer);
    this.timer = null;
  }

  clear() {
    this.cancelScheduled();
    this.abortController?.abort();
    this.abortController = null;
    this.sequence += 1;
    this.state.query = "";
    this.state.loading = false;
    this.state.error = null;
    this.state.results = [];
    this.state.result = null;
    this.emit();
    return this.snapshot();
  }

  setQuery(query, { immediate = false } = {}) {
    this.state.query = String(query || "").trim();
    this.state.error = null;
    this.emit();
    this.cancelScheduled();
    if (!this.state.query && !this.allowEmptyQuery) return Promise.resolve(this.clear());
    if (immediate || this.debounceMs === 0) return this.run();
    this.timer = window.setTimeout(() => {
      this.timer = null;
      void this.run();
    }, this.debounceMs);
    return Promise.resolve(this.snapshot());
  }

  async run() {
    const query = this.state.query;
    if (!query && !this.allowEmptyQuery) return this.snapshot();
    this.abortController?.abort();
    const controller = new AbortController();
    this.abortController = controller;
    const sequence = ++this.sequence;
    this.state.loading = true;
    this.state.error = null;
    this.emit();
    try {
      const result = await this.search(query, { signal: controller.signal });
      if (sequence !== this.sequence || controller.signal.aborted) return this.snapshot();
      this.state.result = result ?? null;
      this.state.results = this.getResults(result);
    } catch (error) {
      if (controller.signal.aborted || sequence !== this.sequence) return this.snapshot();
      this.state.error = error instanceof Error ? error.message : "Ricerca non riuscita";
      this.state.result = null;
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
    this.cancelScheduled();
    this.abortController?.abort();
    this.abortController = null;
    this.sequence += 1;
  }
}
