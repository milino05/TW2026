function plain(value) { return value?.toObject ? value.toObject() : value; }

function syntheticLegacyVariant(source) {
  const representations = Array.isArray(source?.representations) ? source.representations.map(plain) : [];
  if (!representations.length) return null;
  return {
    key: "legacy_default",
    label: "Legacy default",
    description: "Variante sintetica per revisioni precedenti al modello PresentationVariant",
    semanticFocus: [],
    presentationAspects: [],
    representations,
    legacy: true,
  };
}

function getPresentationVariants(source) {
  if (Array.isArray(source)) return [{ key: "legacy_default", label: "Legacy default", semanticFocus: [], presentationAspects: [], representations: source.map(plain), legacy: true }];
  const variants = Array.isArray(source?.presentationVariants) ? source.presentationVariants.map(plain) : [];
  if (variants.length) return variants;
  const legacy = syntheticLegacyVariant(source);
  return legacy ? [legacy] : [];
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
        legacy: variant.legacy === true,
      });
    }
  }
  return candidates;
}

function getDefaultCandidate(source) {
  const candidates = listRepresentationCandidates(source);
  if (!candidates.length) return null;
  if (source && !Array.isArray(source) && source.defaultPresentation?.variantKey) {
    const exact = candidates.find((candidate) => candidate.variantKey === source.defaultPresentation.variantKey && candidate.representation.durationKey === source.defaultPresentation.durationKey && candidate.representation.languageLevelKey === source.defaultPresentation.languageLevelKey);
    if (exact) return exact;
  }
  const legacyDefault = candidates.find((candidate) => candidate.representation.isDefault === true);
  return legacyDefault || candidates[0];
}

function getVariant(source, variantKey) {
  return getPresentationVariants(source).find((variant) => variant.key === variantKey) || null;
}

module.exports = { getPresentationVariants, listRepresentationCandidates, getDefaultCandidate, getVariant };
