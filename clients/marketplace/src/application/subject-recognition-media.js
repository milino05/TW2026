function id(value) { return String(value?.id || value?._id || value || ""); }

export function wikidataIdentity(subject) {
  const identities = Array.isArray(subject?.externalIdentities) ? subject.externalIdentities : [];
  return identities.find((entry) => entry.scheme === "wikidata" && entry.role === "canonical")
    || identities.find((entry) => entry.scheme === "wikidata")
    || null;
}

export function writableRecognitionMedia(entry) {
  if (!entry?.url) return null;
  return {
    url: String(entry.url),
    originalUrl: entry.originalUrl || null,
    altText: entry.altText || null,
    mimeType: entry.mimeType || null,
    width: entry.width || null,
    height: entry.height || null,
    source: entry.source ? { ...entry.source } : null,
    rights: entry.rights ? { ...entry.rights } : null,
  };
}

export async function suggestRecognitionMedia(subject, semanticRepository) {
  const identity = wikidataIdentity(subject);
  if (!identity) return { media: null, reason: "no_wikidata", wikidataId: null };
  try {
    const resolution = await semanticRepository.resolveExternal({ scheme: "wikidata", id: id(identity.id), locale: "it", includeMedia: true });
    return {
      media: writableRecognitionMedia(resolution.mediaCandidates?.[0] || null),
      reason: resolution.mediaCandidates?.length ? "found" : "not_found",
      wikidataId: id(identity.id),
    };
  } catch {
    return { media: null, reason: "unavailable", wikidataId: id(identity.id) };
  }
}
