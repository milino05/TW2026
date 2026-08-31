function normalizedPage(value, fallback = 1) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export class QueryState {
  constructor({ query = "", filters = {}, sort = "", page = 1, pageSize = 20 } = {}) {
    this.query = String(query || "");
    this.filters = { ...(filters || {}) };
    this.sort = String(sort || "");
    this.page = normalizedPage(page);
    this.pageSize = normalizedPage(pageSize, 20);
  }

  setQuery(query) { this.query = String(query || ""); this.page = 1; return this; }
  setFilter(key, value) {
    if (value === undefined || value === null || value === "") delete this.filters[key];
    else this.filters[key] = value;
    this.page = 1;
    return this;
  }
  setSort(sort) { this.sort = String(sort || ""); this.page = 1; return this; }
  setPage(page) { this.page = normalizedPage(page); return this; }
  nextPage() { this.page += 1; return this; }
  previousPage() { this.page = Math.max(1, this.page - 1); return this; }

  snapshot() {
    return { query: this.query, filters: { ...this.filters }, sort: this.sort, page: this.page, pageSize: this.pageSize };
  }

  toSearchParams() {
    const params = new URLSearchParams();
    if (this.query) params.set("q", this.query);
    if (this.sort) params.set("sort", this.sort);
    if (this.page > 1) params.set("page", String(this.page));
    if (this.pageSize !== 20) params.set("pageSize", String(this.pageSize));
    for (const [key, value] of Object.entries(this.filters).sort(([left], [right]) => left.localeCompare(right))) {
      if (Array.isArray(value)) value.forEach((entry) => params.append(key, String(entry)));
      else params.set(key, String(value));
    }
    return params;
  }
}

export function createQueryState(options) { return new QueryState(options); }
