export class QueryState {
  query: string;
  filters: Record<string, unknown>;
  sort: string;
  page: number;
  pageSize: number;

  constructor({ query = "", filters = {}, sort = "", page = 1, pageSize = 20 }: {
    query?: string;
    filters?: Record<string, unknown>;
    sort?: string;
    page?: number;
    pageSize?: number;
  } = {}) {
    this.query = String(query || "");
    this.filters = { ...filters };
    this.sort = String(sort || "");
    this.page = QueryState.page(page);
    this.pageSize = QueryState.page(pageSize, 20);
  }

  static page(value: number, fallback = 1) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
  }

  setQuery(query: string) { this.query = String(query || ""); this.page = 1; return this; }
  setFilter(key: string, value: unknown) {
    if (value === undefined || value === null || value === "") delete this.filters[key];
    else this.filters[key] = value;
    this.page = 1;
    return this;
  }
  setSort(sort: string) { this.sort = String(sort || ""); this.page = 1; return this; }
  setPage(page: number) { this.page = QueryState.page(page); return this; }
  nextPage() { this.page += 1; return this; }
  previousPage() { this.page = Math.max(1, this.page - 1); return this; }
  snapshot() { return { query: this.query, filters: { ...this.filters }, sort: this.sort, page: this.page, pageSize: this.pageSize }; }
}
