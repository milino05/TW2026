const BoundedTtlCache = require("../cache");
const { SemanticProviderUnavailableError } = require("../providerErrors");

const DEFAULT_API_URL = "https://www.wikidata.org/w/api.php";
const DEFAULT_USER_AGENT = "ArtAroundTW2026/1.0 (https://github.com/milino05/TW2026)";
const TRANSIENT_HTTP_STATUSES = new Set([429, 502, 503, 504]);
const TRANSIENT_API_CODES = new Set(["maxlag", "ratelimited"]);

function boundedNumber(value, { fallback, min, max }) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}

function normalizedLanguage(locale) {
  const value = String(locale || "it").trim().toLowerCase().replace("_", "-");
  return /^[a-z]{2,3}(?:-[a-z0-9-]+)?$/.test(value) ? value.split("-")[0] : "it";
}

function normalizeEntityId(value) {
  const id = String(value || "").trim().toUpperCase();
  return /^[QP][1-9]\d*$/.test(id) ? id : null;
}

function entityKindForId(id) {
  return String(id || "").startsWith("P") ? "property" : "item";
}

function localizedValue(values, language) {
  return values?.[language]?.value || values?.en?.value || Object.values(values || {})[0]?.value || "";
}

function localizedAliases(values, language) {
  const entries = values?.[language] || values?.en || Object.values(values || {})[0] || [];
  return entries.map((entry) => entry.value).filter(Boolean).slice(0, 12);
}

function parseRetryAfter(value) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, Math.ceil(seconds));
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, Math.ceil((date - Date.now()) / 1000)) : null;
}

function wait(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function providerHttpCode(status) {
  return `http_${Number(status) || 0}`;
}

class WikidataProvider {
  constructor({
    fetchImpl = (...args) => global.fetch(...args),
    sleepImpl = wait,
    timeoutMs = process.env.SEMANTIC_RESOLVER_TIMEOUT_MS,
    retryCount = process.env.SEMANTIC_RESOLVER_RETRY_COUNT,
    retryBaseMs = process.env.SEMANTIC_RESOLVER_RETRY_BASE_MS,
    maxAutoRetryAfterMs = process.env.SEMANTIC_RESOLVER_MAX_AUTO_RETRY_AFTER_MS,
  } = {}) {
    this.scheme = "wikidata";
    this.apiUrl = process.env.WIKIDATA_API_URL || DEFAULT_API_URL;
    this.userAgent = process.env.WIKIDATA_USER_AGENT || DEFAULT_USER_AGENT;
    this.timeoutMs = boundedNumber(timeoutMs, { fallback: 5000, min: 10, max: 30000 });
    this.retryCount = Math.trunc(boundedNumber(retryCount, { fallback: 1, min: 0, max: 2 }));
    this.retryBaseMs = boundedNumber(retryBaseMs, { fallback: 300, min: 0, max: 5000 });
    this.maxAutoRetryAfterMs = boundedNumber(maxAutoRetryAfterMs, { fallback: 2000, min: 0, max: 10000 });
    this.fetchImpl = fetchImpl;
    this.sleepImpl = sleepImpl;
    this.searchCache = new BoundedTtlCache({
      maxEntries: Number(process.env.SEMANTIC_RESOLVER_CACHE_MAX_ENTRIES) || 300,
      ttlMs: Number(process.env.SEMANTIC_RESOLVER_SEARCH_CACHE_TTL_MS) || 120000,
    });
    this.resolveCache = new BoundedTtlCache({
      maxEntries: Number(process.env.SEMANTIC_RESOLVER_CACHE_MAX_ENTRIES) || 300,
      ttlMs: Number(process.env.SEMANTIC_RESOLVER_RESOLVE_CACHE_TTL_MS) || 600000,
    });
  }

  descriptor() {
    return {
      scheme: this.scheme,
      label: "Wikidata",
      entityKinds: ["item", "property"],
      attribution: {
        label: "Dati semantici da Wikidata",
        url: "https://www.wikidata.org/",
      },
    };
  }

  requestUrl(params, interactionMode) {
    const url = new URL(this.apiUrl);
    const providerParameters = {
      action: params.action,
      format: "json",
      ...(interactionMode === "background" ? { maxlag: "5" } : {}),
      ...params,
    };
    for (const [key, value] of Object.entries(providerParameters)) {
      if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
    }
    return url;
  }

  async requestOnce(params, { interactionMode }) {
    const url = this.requestUrl(params, interactionMode);
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        headers: { Accept: "application/json", "User-Agent": this.userAgent },
        signal: abortController.signal,
      });
      const retryAfterSeconds = parseRetryAfter(response.headers?.get?.("retry-after"));
      let body;
      try {
        body = await response.json();
      } catch (error) {
        if (!response.ok) {
          throw new SemanticProviderUnavailableError("Wikidata non disponibile", {
            retryAfterSeconds,
            providerCode: providerHttpCode(response.status),
            retryable: TRANSIENT_HTTP_STATUSES.has(response.status),
            cause: error,
          });
        }
        throw new SemanticProviderUnavailableError("Wikidata ha restituito una risposta non valida", {
          providerCode: "invalid_response",
          retryable: true,
          cause: error,
        });
      }
      if (!response.ok) {
        const providerCode = body?.error?.code || providerHttpCode(response.status);
        throw new SemanticProviderUnavailableError("Wikidata non disponibile", {
          retryAfterSeconds,
          providerCode,
          retryable: TRANSIENT_HTTP_STATUSES.has(response.status)
            || TRANSIENT_API_CODES.has(String(providerCode).toLowerCase()),
        });
      }
      if (body?.error) {
        const providerCode = String(body.error.code || "api_error").toLowerCase();
        throw new SemanticProviderUnavailableError(
          providerCode === "maxlag" ? "Wikidata temporaneamente occupata" : "Wikidata ha rifiutato la richiesta",
          {
            retryAfterSeconds: retryAfterSeconds ?? (providerCode === "maxlag" ? 5 : null),
            providerCode,
            retryable: TRANSIENT_API_CODES.has(providerCode),
          },
        );
      }
      return body;
    } catch (error) {
      if (error instanceof SemanticProviderUnavailableError) throw error;
      const timedOut = error?.name === "AbortError";
      throw new SemanticProviderUnavailableError(timedOut ? "Wikidata non ha risposto in tempo" : "Wikidata non raggiungibile", {
        providerCode: timedOut ? "timeout" : "network_error",
        retryable: true,
        cause: error,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  retryDelayMs(error, completedRetries) {
    if (!error.retryable || completedRetries >= this.retryCount) return null;
    if (error.retryAfterSeconds !== null && error.retryAfterSeconds !== undefined) {
      const requestedDelay = Math.max(0, Number(error.retryAfterSeconds) * 1000);
      return requestedDelay <= this.maxAutoRetryAfterMs ? requestedDelay : null;
    }
    return this.retryBaseMs * (2 ** completedRetries);
  }

  async request(params, { interactionMode = "interactive" } = {}) {
    const mode = interactionMode === "background" ? "background" : "interactive";
    let completedRetries = 0;
    while (true) {
      try {
        return await this.requestOnce(params, { interactionMode: mode });
      } catch (error) {
        if (!(error instanceof SemanticProviderUnavailableError)) throw error;
        const delayMs = this.retryDelayMs(error, completedRetries);
        if (delayMs === null) {
          error.attempts = completedRetries + 1;
          throw error;
        }
        await this.sleepImpl(delayMs);
        completedRetries += 1;
      }
    }
  }

  async search({ query, locale = "it", entityKind = "item", limit = 10, interactionMode = "interactive" }) {
    const language = normalizedLanguage(locale);
    const kind = entityKind === "property" ? "property" : "item";
    const cacheKey = `${language}:${kind}:${limit}:${String(query).toLowerCase()}`;
    return this.searchCache.coalesce(cacheKey, async () => {
      const body = await this.request({
        action: "wbsearchentities",
        search: query,
        language,
        uselang: language,
        type: kind,
        limit,
      }, { interactionMode });
      return (body.search || []).map((result) => ({
        scheme: this.scheme,
        id: result.id,
        canonicalId: result.id,
        redirectedFrom: [],
        entityKind: entityKindForId(result.id),
        label: result.label || result.display?.label?.value || result.id,
        description: result.description || result.display?.description?.value || "",
        aliases: (result.aliases || []).map((alias) => typeof alias === "string" ? alias : alias?.value).filter(Boolean).slice(0, 12),
        providerUrl: result.concepturi || `https://www.wikidata.org/wiki/${result.id}`,
      }));
    });
  }

  async resolve({ id, locale = "it", interactionMode = "interactive" }) {
    const normalizedId = normalizeEntityId(id);
    if (!normalizedId) return { status: "invalid_identifier", requestedId: String(id || "") };
    const language = normalizedLanguage(locale);
    const cacheKey = `${language}:${normalizedId}`;
    return this.resolveCache.coalesce(cacheKey, async () => {
      const body = await this.request({
        action: "wbgetentities",
        ids: normalizedId,
        redirects: "yes",
        props: "labels|descriptions|aliases",
        languages: `${language}|en`,
        languagefallback: "1",
      }, { interactionMode });
      const redirect = (body.redirects || []).find((entry) => String(entry.from).toUpperCase() === normalizedId);
      const canonicalId = normalizeEntityId(redirect?.to) || normalizedId;
      const entity = body.entities?.[canonicalId] || body.entities?.[normalizedId];
      if (!entity || entity.missing !== undefined) {
        return { status: "not_found", requestedId: normalizedId, canonicalId: null };
      }
      return {
        status: redirect ? "redirected" : "resolved",
        requestedId: normalizedId,
        canonicalId,
        candidate: {
          scheme: this.scheme,
          id: canonicalId,
          canonicalId,
          redirectedFrom: redirect ? [normalizedId] : [],
          entityKind: entityKindForId(canonicalId),
          label: localizedValue(entity.labels, language) || canonicalId,
          description: localizedValue(entity.descriptions, language),
          aliases: localizedAliases(entity.aliases, language),
          providerUrl: `https://www.wikidata.org/wiki/${canonicalId}`,
        },
      };
    });
  }
}

module.exports = {
  WikidataProvider,
  normalizeEntityId,
  normalizedLanguage,
  parseRetryAfter,
};
