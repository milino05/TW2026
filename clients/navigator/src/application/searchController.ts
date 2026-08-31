export type SearchState<T, TResult = T[]> = {
  query: string;
  loading: boolean;
  error: string | null;
  results: T[];
  result: TResult | null;
  selected: T | null;
};

function defaultGetResults<T, TResult>(result: TResult): T[] {
  if (Array.isArray(result)) return result as unknown as T[];
  const candidate = result as { results?: unknown } | null | undefined;
  return Array.isArray(candidate?.results) ? candidate.results as T[] : [];
}

export class SearchController<T, TResult = T[]> {
  state: SearchState<T, TResult> = { query: "", loading: false, error: null, results: [], result: null, selected: null };
  private timer: number | null = null;
  private abortController: AbortController | null = null;
  private sequence = 0;

  constructor(private options: {
    search: (query: string, context: { signal: AbortSignal }) => Promise<TResult>;
    getResults?: (result: TResult) => T[];
    debounceMs?: number;
    allowEmptyQuery?: boolean;
    onStateChange?: (state: SearchState<T, TResult>) => void;
  }) {
    if (typeof options.search !== "function") throw new TypeError("SearchController requires search().");
    if (options.getResults && typeof options.getResults !== "function") throw new TypeError("SearchController getResults must be a function.");
  }

  snapshot(): SearchState<T, TResult> { return { ...this.state, results: [...this.state.results] }; }
  private emit() { this.options.onStateChange?.(this.snapshot()); }
  private cancelScheduled() {
    if (this.timer !== null) window.clearTimeout(this.timer);
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

  setQuery(query: string, { immediate = false } = {}) {
    this.state.query = String(query || "").trim();
    this.state.error = null;
    this.emit();
    this.cancelScheduled();
    if (!this.state.query && !this.options.allowEmptyQuery) return Promise.resolve(this.clear());
    const debounceMs = Math.max(0, Number(this.options.debounceMs ?? 250) || 0);
    if (immediate || debounceMs === 0) return this.run();
    this.timer = window.setTimeout(() => { this.timer = null; void this.run(); }, debounceMs);
    return Promise.resolve(this.snapshot());
  }

  async run() {
    const query = this.state.query;
    if (!query && !this.options.allowEmptyQuery) return this.snapshot();
    this.abortController?.abort();
    const controller = new AbortController();
    this.abortController = controller;
    const sequence = ++this.sequence;
    this.state.loading = true;
    this.state.error = null;
    this.emit();
    try {
      const result = await this.options.search(query, { signal: controller.signal });
      if (sequence !== this.sequence || controller.signal.aborted) return this.snapshot();
      this.state.result = result ?? null;
      this.state.results = (this.options.getResults || defaultGetResults<T, TResult>)(result);
    } catch (cause) {
      if (controller.signal.aborted || sequence !== this.sequence) return this.snapshot();
      this.state.error = cause instanceof Error ? cause.message : "Ricerca non riuscita";
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
  select(value: T | null) { this.state.selected = value; this.emit(); return this.snapshot(); }
  clearSelection() { return this.select(null); }
  dispose() {
    this.cancelScheduled();
    this.abortController?.abort();
    this.abortController = null;
    this.sequence += 1;
  }
}
