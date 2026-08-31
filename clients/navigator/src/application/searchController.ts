export type SearchState<T> = {
  query: string;
  loading: boolean;
  error: string | null;
  results: T[];
  selected: T | null;
};

export class SearchController<T> {
  state: SearchState<T> = { query: "", loading: false, error: null, results: [], selected: null };
  private timer: number | null = null;
  private abortController: AbortController | null = null;
  private sequence = 0;

  constructor(private options: {
    search: (query: string, context: { signal: AbortSignal }) => Promise<T[]>;
    debounceMs?: number;
    onStateChange?: (state: SearchState<T>) => void;
  }) {
    if (typeof options.search !== "function") throw new TypeError("SearchController requires search().");
  }

  snapshot(): SearchState<T> { return { ...this.state, results: [...this.state.results] }; }
  private emit() { this.options.onStateChange?.(this.snapshot()); }

  setQuery(query: string, { immediate = false } = {}) {
    this.state.query = String(query || "").trim();
    this.state.error = null;
    this.emit();
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    if (!this.state.query) {
      this.abortController?.abort();
      this.sequence += 1;
      this.state.loading = false;
      this.state.results = [];
      this.emit();
      return Promise.resolve(this.snapshot());
    }
    const debounceMs = Math.max(0, Number(this.options.debounceMs ?? 250) || 0);
    if (immediate || debounceMs === 0) return this.run();
    this.timer = window.setTimeout(() => { this.timer = null; void this.run(); }, debounceMs);
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
      const results = await this.options.search(query, { signal: controller.signal });
      if (sequence !== this.sequence || controller.signal.aborted) return this.snapshot();
      this.state.results = Array.isArray(results) ? results : [];
    } catch (cause) {
      if (controller.signal.aborted || sequence !== this.sequence) return this.snapshot();
      this.state.error = cause instanceof Error ? cause.message : "Ricerca non riuscita";
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
  select(value: T | null) { this.state.selected = value; this.emit(); return this.snapshot(); }
  dispose() {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    this.abortController?.abort();
    this.sequence += 1;
  }
}
