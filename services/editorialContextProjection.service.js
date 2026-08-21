const User = require("../models/user");
const Organization = require("../models/organization.model");

function buildEditorialContextSummary({ editorialContext, contentSpace, namespace, curator }) {
  return {
    id: editorialContext._id,
    name: editorialContext.displayName,
    shortDescription: editorialContext.shortDescription ?? null,
    contentSpace: { id: contentSpace._id, name: contentSpace.name },
    namespace: { id: namespace._id, name: namespace.name },
    curator,
    // EditorialRelease is introduced in the next slice. No release means no
    // published content can yet be counted for this context.
    stats: { availableItemCount: 0, subjectCount: 0 },
  };
}

async function resolveCurator(contentSpace) {
  if (contentSpace.ownerType === "organization") {
    const organization = await Organization.findById(contentSpace.ownerId).select("name").lean();
    return { id: contentSpace.ownerId, displayName: organization?.name || "Organizzazione" };
  }
  const user = await User.findById(contentSpace.ownerId).select("username").lean();
  return { id: contentSpace.ownerId, displayName: user?.username || "Utente" };
}

async function projectEditorialContext({ editorialContext, contentSpace, namespace }) {
  const curator = await resolveCurator(contentSpace);
  return buildEditorialContextSummary({ editorialContext, contentSpace, namespace, curator });
}

module.exports = { buildEditorialContextSummary, projectEditorialContext };
