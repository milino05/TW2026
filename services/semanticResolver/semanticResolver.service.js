const Subject = require("../../models/subject.model");
const AppError = require("../../utils/AppError");
const { projectSubject } = require("../subjectProjection.service");
const { getProvider, listProviders } = require("./providerRegistry.service");
const { SemanticProviderUnavailableError } = require("./providerErrors");

function normalizedScheme(value) {
  return String(value || "").trim().toLowerCase();
}

function providerOrFail(scheme) {
  const normalized = normalizedScheme(scheme);
  const provider = getProvider(normalized);
  if (!provider) {
    throw new AppError("Provider semantico non supportato", 400, [{
      field: "scheme",
      code: "UNSUPPORTED_SCHEME",
      scheme: normalized,
    }]);
  }
  return provider;
}

function unavailableError(error, scheme) {
  if (!(error instanceof SemanticProviderUnavailableError)) return error;
  const providerName = scheme === "wikidata" ? "Wikidata" : "il provider semantico";
  const messages = {
    dns_error: `Il server non riesce a risolvere l'indirizzo di ${providerName}. Controlla la configurazione DNS e riprova.`,
    network_error: `Il server non riesce a raggiungere ${providerName}. Controlla la connessione e riprova.`,
    timeout: `${providerName} non ha risposto in tempo. Riprova tra poco.`,
  };
  return new AppError(messages[error.providerCode] || "Provider semantico temporaneamente non disponibile", 503, [{
    code: "PROVIDER_UNAVAILABLE",
    scheme,
    retryAfterSeconds: error.retryAfterSeconds,
    providerCode: error.providerCode,
    retryable: error.retryable,
    attempts: error.attempts,
  }]);
}

async function subjectsBoundTo({ scheme, ids }) {
  const normalizedIds = [...new Set(ids.map((id) => String(id || "").trim()).filter(Boolean))];
  if (!normalizedIds.length) return [];
  return Subject.find({
    externalIdentities: {
      $elemMatch: { scheme: normalizedScheme(scheme), id: { $in: normalizedIds } },
    },
  });
}

function bindingForCandidate(subjects, candidate) {
  const matching = subjects.find((subject) => (subject.externalIdentities || []).some((identity) => (
    identity.scheme === candidate.scheme && identity.id === candidate.id
  )));
  return matching ? projectSubject(matching) : null;
}

function providersProjection() {
  return { providers: listProviders() };
}

async function search({ scheme, query, locale = "it", entityKind = "item", limit = 10 }) {
  const provider = providerOrFail(scheme);
  const normalizedQuery = String(query || "").trim();
  if (!normalizedQuery) {
    throw new AppError("Query semantica obbligatoria", 400, [{ field: "query", code: "REQUIRED" }]);
  }
  if (!["item", "property"].includes(entityKind)) {
    throw new AppError("entityKind non valido", 400, [{ field: "entityKind", code: "INVALID_ENUM" }]);
  }
  const numericLimit = Math.min(20, Math.max(1, Number(limit) || 10));
  let candidates;
  try {
    candidates = await provider.search({ query: normalizedQuery, locale, entityKind, limit: numericLimit });
  } catch (error) {
    throw unavailableError(error, provider.scheme);
  }
  const boundSubjects = await subjectsBoundTo({ scheme: provider.scheme, ids: candidates.map((candidate) => candidate.id) });
  return {
    status: "ok",
    provider: provider.descriptor(),
    query: { text: normalizedQuery, locale, entityKind },
    candidates: candidates.map((candidate) => ({
      ...candidate,
      alreadyBoundSubject: bindingForCandidate(boundSubjects, candidate),
    })),
  };
}

async function resolve({ scheme, id, locale = "it", includeMedia = false }) {
  const provider = providerOrFail(scheme);
  let resolution;
  try {
    resolution = await provider.resolve({ id, locale });
  } catch (error) {
    throw unavailableError(error, provider.scheme);
  }
  if (resolution.status === "invalid_identifier") {
    throw new AppError("Identificatore esterno non valido", 400, [{
      field: "id",
      code: "INVALID_EXTERNAL_IDENTIFIER",
      scheme: provider.scheme,
    }]);
  }
  if (resolution.status === "not_found") {
    throw new AppError("Identita esterna non trovata", 404, [{
      field: "id",
      code: "EXTERNAL_IDENTITY_NOT_FOUND",
      scheme: provider.scheme,
      id: resolution.requestedId,
    }]);
  }
  const boundSubjects = await subjectsBoundTo({
    scheme: provider.scheme,
    ids: [resolution.requestedId, resolution.canonicalId],
  });
  let mediaCandidates = [];
  let mediaStatus = includeMedia ? "not_found" : "not_requested";
  if (includeMedia && typeof provider.mediaCandidates === "function") {
    try {
      mediaCandidates = await provider.mediaCandidates({ id: resolution.canonicalId, locale });
      mediaStatus = mediaCandidates.length ? "available" : "not_found";
    } catch (error) {
      if (!(error instanceof SemanticProviderUnavailableError)) throw error;
      mediaStatus = "unavailable";
    }
  }
  return {
    ...resolution,
    provider: provider.descriptor(),
    boundSubjects: boundSubjects.map(projectSubject),
    mediaStatus,
    mediaCandidates,
  };
}

module.exports = {
  providersProjection,
  search,
  resolve,
  subjectsBoundTo,
};
