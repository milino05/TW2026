function plain(value) { return value?.toObject ? value.toObject() : value; }

function getPresentationVariants(source) {
  if (!source || Array.isArray(source)) return [];
  return Array.isArray(source.presentationVariants)
    ? source.presentationVariants.map(plain)
    : [];
}

function listRepresentationCandidates(source) {
  const candidates = [];
  for (const variant of getPresentationVariants(source)) {
    for (const representation of variant.representations || []) {
      candidates.push({
        variantKey: variant.key,
        variantLabel: variant.label,
        semanticFocus: variant.semanticFocus || [],
        presentationAspects: variant.presentationAspects || [],
        representation: plain(representation),
      });
    }
  }
  return candidates;
}

function getDefaultCandidate(source) {
  const candidates = listRepresentationCandidates(source);
  if (!candidates.length) return null;
  const definition = source?.defaultPresentation;
  if (definition?.variantKey) {
    return candidates.find((candidate) =>
      candidate.variantKey === definition.variantKey &&
      candidate.representation.durationKey === definition.durationKey &&
      candidate.representation.languageLevelKey === definition.languageLevelKey,
    ) || null;
  }
  return null;
}

function getVariant(source, variantKey) {
  return getPresentationVariants(source).find((variant) => variant.key === variantKey) || null;
}

module.exports = { getPresentationVariants, listRepresentationCandidates, getDefaultCandidate, getVariant };
