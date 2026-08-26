import { userFacingErrorMessage } from "../../application/user-facing-errors.js";

function optionalFiniteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export class ApiError extends Error {
  constructor(message, { status, details = null, retryAfterHeader = null } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = Array.isArray(details) ? details : [];
    const primary = this.details[0] || {};
    this.code = primary.code || null;
    this.providerCode = primary.providerCode || null;
    this.retryable = primary.retryable !== false;
    const detailRetryAfter = optionalFiniteNumber(primary.retryAfterSeconds);
    const headerRetryAfter = optionalFiniteNumber(retryAfterHeader);
    this.retryAfterSeconds = detailRetryAfter ?? headerRetryAfter;
  }
}

export class ApiClient {
  constructor(baseUrl = "/api", { fetchImpl = (...args) => globalThis.fetch(...args) } = {}) {
    this.baseUrl = baseUrl;
    this.fetchImpl = fetchImpl;
  }

  async request(path, init = {}) {
    let response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...(init.headers || {}),
        },
      });
    } catch (error) {
      const message = error?.name === "AbortError"
        ? "La richiesta è stata interrotta. Riprova."
        : "Non è stato possibile contattare il servizio. Controlla la connessione e riprova.";
      throw new ApiError(message, { status: 0 });
    }
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const details = body?.errors;
      throw new ApiError(userFacingErrorMessage(body?.message || `HTTP ${response.status}`, { status: response.status, details }), {
        status: response.status,
        details,
        retryAfterHeader: response.headers.get("retry-after"),
      });
    }
    return body;
  }
}

export const apiClient = new ApiClient();
