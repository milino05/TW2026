const { resolveGenerationSources } = require("./generationSourceV2.service");

/**
 * Authorization boundary for explicit generator editorial sources.
 *
 * Venue.primaryEditorialContextId is intentionally not handled here: default
 * sources depend on the selected PhysicalScope and are resolved by the
 * generator/options resolver through the same generation-source service.
 *
 * Explicit sources are typed as either a live EditorialContext or an immutable
 * EditorialRelease. The resolver enforces context.generate and the requested
 * live/pinned semantics instead of silently replacing one source type with the
 * other.
 */
async function assertGenerationRequestAccess({ request = {}, actorUserId }) {
  if (!Object.prototype.hasOwnProperty.call(request, "editorialSources")) return [];
  return resolveGenerationSources({ sources: request.editorialSources, actorUserId });
}

module.exports = { assertGenerationRequestAccess };
