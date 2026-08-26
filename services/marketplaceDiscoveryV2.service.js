const Organization = require("../models/organization.model");
const Venue = require("../models/venue.model");
const VenueRelease = require("../models/venueRelease.model");
const VenueTarget = require("../models/venueTarget.model");
const MarketplaceListing = require("../models/marketplaceListing.model");
const MarketplaceOffer = require("../models/marketplaceOffer.model");
const AppError = require("../utils/AppError");

function id(value) { return String(value?._id || value || ""); }
function clampPage(value) { return Math.max(1, Number(value) || 1); }
function clampLimit(value, fallback = 12) { return Math.max(1, Math.min(50, Number(value) || fallback)); }
function escapedRegex(value) { return String(value || "").trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function textQuery(q) {
  const term = escapedRegex(q);
  return term ? { $or: [{ name: { $regex: term, $options: "i" } }, { description: { $regex: term, $options: "i" } }] } : {};
}

async function organizationCounts(organizationIds) {
  if (!organizationIds.length) return new Map();
  const activeListingIds = await MarketplaceOffer.distinct("listingId", { status: "active" });
  const [venueCounts, listingCounts] = await Promise.all([
    Venue.aggregate([
      { $match: { ownerOrganizationId: { $in: organizationIds }, lifecycleStatus: "active", publishedReleaseId: { $ne: null } } },
      { $group: { _id: "$ownerOrganizationId", count: { $sum: 1 } } },
    ]),
    MarketplaceListing.aggregate([
      { $match: { _id: { $in: activeListingIds }, sellerType: "organization", sellerId: { $in: organizationIds }, status: "published" } },
      { $group: { _id: "$sellerId", count: { $sum: 1 } } },
    ]),
  ]);
  const result = new Map(organizationIds.map((organizationId) => [id(organizationId), { venues: 0, publications: 0 }]));
  for (const entry of venueCounts) result.get(id(entry._id)).venues = entry.count;
  for (const entry of listingCounts) result.get(id(entry._id)).publications = entry.count;
  return result;
}

async function organizationDirectory({ q = "", page = 1, limit = 12 } = {}) {
  const normalizedPage = clampPage(page);
  const normalizedLimit = clampLimit(limit);
  const filter = { lifecycleStatus: "active", ...textQuery(q) };
  const [organizations, total] = await Promise.all([
    Organization.find(filter).sort({ name: 1 }).skip((normalizedPage - 1) * normalizedLimit).limit(normalizedLimit).select("name description").lean(),
    Organization.countDocuments(filter),
  ]);
  const counts = await organizationCounts(organizations.map((entry) => entry._id));
  return {
    results: organizations.map((organization) => ({ id: organization._id, name: organization.name, description: organization.description || "", counts: counts.get(id(organization._id)) || { venues: 0, publications: 0 } })),
    page: normalizedPage,
    pageSize: normalizedLimit,
    total,
  };
}

async function organizationPublicProfile({ organizationId }) {
  const organization = await Organization.findOne({ _id: organizationId, lifecycleStatus: "active" }).select("name description").lean();
  if (!organization) throw new AppError("Organizzazione non trovata", 404);
  const activeListingIds = await MarketplaceOffer.distinct("listingId", { status: "active" });
  const [venues, publications] = await Promise.all([
    Venue.find({ ownerOrganizationId: organization._id, lifecycleStatus: "active", publishedReleaseId: { $ne: null } }).sort({ name: 1 }).select("name description publishedReleaseId").lean(),
    MarketplaceListing.find({ _id: { $in: activeListingIds }, sellerType: "organization", sellerId: organization._id, status: "published" }).sort({ publishedAt: -1, _id: -1 }).limit(8).select("title summary resourceType publishedAt").lean(),
  ]);
  return {
    organization: { id: organization._id, name: organization.name, description: organization.description || "" },
    venues: venues.map((venue) => ({ id: venue._id, name: venue.name, description: venue.description || "" })),
    publications: publications.map((listing) => ({ listingId: listing._id, title: listing.title || "Risorsa", summary: listing.summary || "", resourceType: listing.resourceType, publishedAt: listing.publishedAt || null })),
  };
}

async function venueDirectory({ q = "", page = 1, limit = 12 } = {}) {
  const normalizedPage = clampPage(page);
  const normalizedLimit = clampLimit(limit);
  const filter = { lifecycleStatus: "active", publishedReleaseId: { $ne: null }, ...textQuery(q) };
  const [venues, total] = await Promise.all([
    Venue.find(filter).sort({ name: 1 }).skip((normalizedPage - 1) * normalizedLimit).limit(normalizedLimit).select("name description ownerOrganizationId publishedReleaseId").lean(),
    Venue.countDocuments(filter),
  ]);
  const organizationIds = [...new Set(venues.map((entry) => id(entry.ownerOrganizationId)))];
  const organizations = organizationIds.length ? await Organization.find({ _id: { $in: organizationIds }, lifecycleStatus: "active" }).select("name").lean() : [];
  const organizationById = new Map(organizations.map((entry) => [id(entry._id), entry]));
  return {
    results: venues.map((venue) => ({ id: venue._id, name: venue.name, description: venue.description || "", organization: { id: venue.ownerOrganizationId, name: organizationById.get(id(venue.ownerOrganizationId))?.name || "Organizzazione" } })),
    page: normalizedPage,
    pageSize: normalizedLimit,
    total,
  };
}

async function venuePublicProfile({ venueId }) {
  const venue = await Venue.findOne({ _id: venueId, lifecycleStatus: "active", publishedReleaseId: { $ne: null } }).select("name description ownerOrganizationId publishedReleaseId").lean();
  if (!venue) throw new AppError("Sede pubblica non trovata", 404);
  const [organization, release] = await Promise.all([
    Organization.findOne({ _id: venue.ownerOrganizationId, lifecycleStatus: "active" }).select("name description").lean(),
    VenueRelease.findOne({ _id: venue.publishedReleaseId, venueId: venue._id, status: "published" }).lean(),
  ]);
  if (!organization || !release) throw new AppError("Sede pubblica non disponibile", 404);
  const activeBindings = (release.targetBindings || []).filter((entry) => entry.availability === "active");
  const targetIds = activeBindings.map((entry) => entry.venueTargetId);
  const targets = targetIds.length ? await VenueTarget.find({ _id: { $in: targetIds }, venueId: venue._id, lifecycleStatus: "active" }).select("label description subjectId").lean() : [];
  const bindingById = new Map(activeBindings.map((entry) => [id(entry.venueTargetId), entry]));
  return {
    venue: { id: venue._id, name: venue.name, description: venue.description || "", preVisitInformation: release.preVisitInformation || [], version: release.version },
    organization: { id: organization._id, name: organization.name, description: organization.description || "" },
    targets: targets.map((target) => ({ id: target._id, subjectId: target.subjectId, label: target.label, description: target.description || "", recognitionMedia: (bindingById.get(id(target._id))?.recognitionMedia || []).map((media) => ({ url: media.url, altText: media.altText || "" })) })),
  };
}

module.exports = { organizationDirectory, organizationPublicProfile, venueDirectory, venuePublicProfile };
