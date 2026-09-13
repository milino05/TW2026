const mongoose = require("mongoose");
const Venue = require("../models/venue.model");
const VenueRelease = require("../models/venueRelease.model");
const VenueTarget = require("../models/venueTarget.model");
const LayoutRevision = require("../models/layoutRevision.model");
const Subject = require("../models/subject.model");
const AppError = require("../utils/AppError");
const { resolveVenueTargetExhibit } = require("./venueExhibitResolution.service");

function id(value) { return String(value?._id || value || ""); }

function uniqueObjectIds(values = []) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const key = id(value);
    if (!key || seen.has(key) || !mongoose.isValidObjectId(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

async function resolvePublishedOccurrencesForSubjects(subjectIds = []) {
  const subjectsRequested = uniqueObjectIds(subjectIds);
  const bySubject = new Map(subjectsRequested.map((subjectId) => [id(subjectId), []]));
  if (!subjectsRequested.length) return bySubject;

  const [targets, subjects] = await Promise.all([
    VenueTarget.find({ subjectId: { $in: subjectsRequested }, lifecycleStatus: "active" })
      .select("_id venueId subjectId displayLabelOverride inventoryNote")
      .lean(),
    Subject.find({ _id: { $in: subjectsRequested } })
      .select("preferredLabel description")
      .lean(),
  ]);
  if (!targets.length) return bySubject;

  const subjectById = new Map(subjects.map((subject) => [id(subject._id), subject]));
  const venueIds = [...new Set(targets.map((target) => id(target.venueId)).filter(Boolean))];
  const venues = venueIds.length
    ? await Venue.find({
        _id: { $in: venueIds },
        lifecycleStatus: "active",
        publishedReleaseId: { $ne: null },
      }).select("_id name publishedReleaseId").lean()
    : [];
  const venueById = new Map(venues.map((venue) => [id(venue._id), venue]));

  const releaseIds = [...new Set(venues.map((venue) => id(venue.publishedReleaseId)).filter(Boolean))];
  const releases = releaseIds.length
    ? await VenueRelease.find({ _id: { $in: releaseIds }, status: "published" })
      .select("_id venueId layoutRevisionId targetBindings")
      .lean()
    : [];
  const releaseById = new Map(releases.map((release) => [id(release._id), release]));

  const layoutIds = [...new Set(releases.map((release) => id(release.layoutRevisionId)).filter(Boolean))];
  const layouts = layoutIds.length
    ? await LayoutRevision.find({
        _id: { $in: layoutIds },
        status: { $in: ["published", "superseded"] },
      }).select("_id venueId floors places exhibitSlots").lean()
    : [];
  const layoutById = new Map(layouts.map((layout) => [id(layout._id), layout]));

  for (const target of targets) {
    const subjectKey = id(target.subjectId);
    if (!bySubject.has(subjectKey)) continue;
    const venue = venueById.get(id(target.venueId));
    if (!venue) continue;
    const release = releaseById.get(id(venue.publishedReleaseId));
    if (!release || id(release.venueId) !== id(venue._id)) continue;
    const layout = layoutById.get(id(release.layoutRevisionId));
    if (!layout || id(layout.venueId) !== id(venue._id)) continue;

    let physical;
    try {
      physical = resolveVenueTargetExhibit({
        venueRelease: release,
        layoutRevision: layout,
        venueTargetId: target._id,
      });
    } catch {
      continue;
    }

    const subject = subjectById.get(subjectKey);
    const floor = (layout.floors || []).find((entry) => id(entry._id) === id(physical.place?.floorId));
    bySubject.get(subjectKey).push({
      venueTargetId: target._id,
      subjectId: target.subjectId,
      label: target.displayLabelOverride || subject?.preferredLabel || "Entità della sede",
      description: target.inventoryNote || subject?.description || "",
      venue: { id: venue._id, name: venue.name },
      location: {
        floorLabel: floor?.label || null,
        placeLabel: physical.place?.label || null,
        exhibitSlotLabel: physical.exhibitSlot?.label || null,
      },
    });
  }

  for (const occurrences of bySubject.values()) {
    occurrences.sort((left, right) => (
      String(left.venue?.name || "").localeCompare(String(right.venue?.name || ""), "it")
      || String(left.location?.floorLabel || "").localeCompare(String(right.location?.floorLabel || ""), "it")
      || String(left.location?.placeLabel || "").localeCompare(String(right.location?.placeLabel || ""), "it")
      || String(left.label || "").localeCompare(String(right.label || ""), "it")
    ));
  }

  return bySubject;
}

async function publishedOccurrenceCandidates(subjectId) {
  const resolved = await resolvePublishedOccurrencesForSubjects([subjectId]);
  return resolved.get(id(subjectId)) || [];
}

async function assertPublishedTargetForSubject(subjectId, venueTargetId) {
  if (!mongoose.isValidObjectId(subjectId) || !mongoose.isValidObjectId(venueTargetId)) {
    throw new AppError("Collocazione fisica non valida", 400, [{ field: "placement", code: "INVALID_OBJECT_ID" }]);
  }
  const candidates = await publishedOccurrenceCandidates(subjectId);
  const candidate = candidates.find((entry) => id(entry.venueTargetId) === id(venueTargetId));
  if (!candidate) {
    throw new AppError("La collocazione scelta non corrisponde al contenuto o non è utilizzabile", 409, [{
      field: "placement.venueTargetId",
      code: "VISIT_CONTENT_OCCURRENCE_INVALID",
      context: { venueTargetId, primarySubjectId: subjectId },
    }]);
  }
  return candidate;
}

async function assertPublishedTargetUsable(venueTargetId) {
  if (!mongoose.isValidObjectId(venueTargetId)) {
    throw new AppError("VenueTarget non valido", 400, [{ field: "venueTargetId", code: "INVALID_OBJECT_ID" }]);
  }
  const target = await VenueTarget.findOne({ _id: venueTargetId, lifecycleStatus: "active" }).select("subjectId").lean();
  if (!target) throw new AppError("VenueTarget non disponibile", 404);
  const candidate = await assertPublishedTargetForSubject(target.subjectId, venueTargetId);
  return candidate;
}

module.exports = {
  resolvePublishedOccurrencesForSubjects,
  publishedOccurrenceCandidates,
  assertPublishedTargetForSubject,
  assertPublishedTargetUsable,
};
