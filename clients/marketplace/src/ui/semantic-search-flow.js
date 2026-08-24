export function normalizeSemanticQuery(value) {
  return String(value || "").trim();
}

export function isExternalEntityId(value) {
  return /^[QP][1-9]\d*$/i.test(normalizeSemanticQuery(value));
}

export function withoutLeadingItalianArticle(value, locale = "it") {
  const query = normalizeSemanticQuery(value);
  const language = String(locale || "it").trim().toLowerCase().split(/[-_]/u)[0];
  if (!query || language !== "it") return null;
  const withoutArticle = query
    .replace(/^l[\u2018\u2019']\s*/iu, "")
    .replace(/^(?:il|lo|la|i|gli|le)\s+/iu, "")
    .trim();
  return withoutArticle && withoutArticle !== query ? withoutArticle : null;
}

function externalQueryMetadata({
  requested,
  variant = null,
  attempted = [requested],
  variantUnavailable = false,
}) {
  return {
    requested,
    variant,
    attempted,
    variantApplied: Boolean(variant),
    variantUnavailable,
  };
}

export function mergeExternalCandidateQueries(requestedCandidates = [], variantCandidates = []) {
  const merged = new Map();
  const add = (candidate, queryMatch) => {
    const key = `${candidate?.scheme || ""}:${candidate?.id || ""}`;
    if (!candidate?.id || !candidate?.scheme) return;
    const existing = merged.get(key);
    if (existing) {
      existing.queryMatches = [...new Set([...(existing.queryMatches || []), queryMatch])];
      return;
    }
    merged.set(key, { ...candidate, queryMatches: [queryMatch] });
  };
  requestedCandidates.forEach((candidate) => add(candidate, "requested"));
  variantCandidates.forEach((candidate) => add(candidate, "variant"));
  return [...merged.values()];
}

export function candidateFromResolution(resolution = {}) {
  if (!resolution.candidate) return [];
  return [{
    ...resolution.candidate,
    requestedId: resolution.requestedId,
    alreadyBoundSubject: resolution.boundSubjects?.[0] || null,
    resolutionStatus: resolution.status,
  }];
}

export async function searchExternalCandidates({
  repository,
  query,
  entityKind = "item",
  locale = "it",
  retryWithoutItalianArticle = false,
}) {
  const normalizedQuery = normalizeSemanticQuery(query);
  if (!normalizedQuery) throw new Error("Inserisci un termine da cercare");

  if (isExternalEntityId(normalizedQuery)) {
    const resolution = await repository.resolveExternal({ id: normalizedQuery, locale });
    return {
      provider: resolution.provider || null,
      candidates: candidateFromResolution(resolution),
      query: externalQueryMetadata({ requested: normalizedQuery }),
    };
  }

  const result = await repository.searchExternal({
    query: normalizedQuery,
    locale,
    entityKind,
  });
  const candidates = result.candidates || [];
  const variantQuery = retryWithoutItalianArticle
    ? withoutLeadingItalianArticle(normalizedQuery, locale)
    : null;
  if (!variantQuery) {
    return {
      provider: result.provider || null,
      candidates,
      query: externalQueryMetadata({ requested: normalizedQuery }),
    };
  }

  let variantResult;
  try {
    variantResult = await repository.searchExternal({
      query: variantQuery,
      locale,
      entityKind,
    });
  } catch (error) {
    if (!candidates.length) throw error;
    return {
      provider: result.provider || null,
      candidates: mergeExternalCandidateQueries(candidates, []),
      query: externalQueryMetadata({
        requested: normalizedQuery,
        variant: variantQuery,
        attempted: [normalizedQuery, variantQuery],
        variantUnavailable: true,
      }),
    };
  }
  return {
    provider: variantResult.provider || result.provider || null,
    candidates: mergeExternalCandidateQueries(candidates, variantResult.candidates || []),
    query: externalQueryMetadata({
      requested: normalizedQuery,
      variant: variantQuery,
      attempted: [normalizedQuery, variantQuery],
    }),
  };
}

export async function searchSubjectCascade({ repository, query, entityKind = "item", locale = "it" }) {
  const normalizedQuery = normalizeSemanticQuery(query);
  if (!normalizedQuery) throw new Error("Inserisci un termine da cercare");

  const localResults = await repository.searchSubjects(normalizedQuery, { match: "label_exact" });
  if (localResults.length) {
    return {
      query: normalizedQuery,
      localResults,
      externalResults: [],
      externalSearched: false,
      provider: null,
      externalQuery: null,
    };
  }

  const external = await searchExternalCandidates({
    repository,
    query: normalizedQuery,
    entityKind,
    locale,
    retryWithoutItalianArticle: true,
  });
  return {
    query: normalizedQuery,
    localResults: [],
    externalResults: external.candidates,
    externalSearched: true,
    provider: external.provider,
    externalQuery: external.query,
  };
}
