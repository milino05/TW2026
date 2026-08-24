class SemanticProviderUnavailableError extends Error {
  constructor(message = "Provider semantico temporaneamente non disponibile", {
    retryAfterSeconds = null,
    providerCode = "provider_unavailable",
    retryable = false,
    attempts = 1,
    cause = null,
  } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "SemanticProviderUnavailableError";
    this.retryAfterSeconds = retryAfterSeconds;
    this.providerCode = providerCode;
    this.retryable = retryable;
    this.attempts = attempts;
  }
}

module.exports = { SemanticProviderUnavailableError };
