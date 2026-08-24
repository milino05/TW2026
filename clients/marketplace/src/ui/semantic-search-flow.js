export function normalizeSemanticQuery(value) {
  return String(value || "").trim();
}

export function isExternalEntityId(value) {
  return /^[QP][1-9]\d*$/i.test(normalizeSemanticQuery(value));
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

export async function searchExternalCandidates({ repository, query, entityKind = "item", locale = "it" }) {
  const normalizedQuery = normalizeSemanticQuery(query);
  if (!normalizedQuery) throw new Error("Inserisci un termine da cercare");

  if (isExternalEntityId(normalizedQuery)) {
    const resolution = await repository.resolveExternal({ id: normalizedQuery, locale });
    return {
      provider: resolution.provider || null,
      candidates: candidateFromResolution(resolution),
    };
  }

  const result = await repository.searchExternal({
    query: normalizedQuery,
    locale,
    entityKind,
  });
  return {
    provider: result.provider || null,
    candidates: result.candidates || [],
  };
}

export async function searchSubjectCascade({ repository, query, entityKind = "item", locale = "it" }) {
  const normalizedQuery = normalizeSemanticQuery(query);
  if (!normalizedQuery) throw new Error("Inserisci un termine da cercare");

  const localResults = await repository.searchSubjects(normalizedQuery);
  if (localResults.length) {
    return {
      query: normalizedQuery,
      localResults,
      externalResults: [],
      externalSearched: false,
      provider: null,
    };
  }

  const external = await searchExternalCandidates({
    repository,
    query: normalizedQuery,
    entityKind,
    locale,
  });
  return {
    query: normalizedQuery,
    localResults: [],
    externalResults: external.candidates,
    externalSearched: true,
    provider: external.provider,
  };
}
