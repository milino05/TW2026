const mongoose = require("mongoose");
const EditorialContext = require("../../models/editorialContext.model");
const SemanticGraph = require("../../models/semanticGraph.model");
const SemanticGraphRevision = require("../../models/semanticGraphRevision.model");

function objectId(value = null) {
  return value ? new mongoose.Types.ObjectId(String(value)) : new mongoose.Types.ObjectId();
}

async function createEditorialContextWithGraph({
  contentSpace,
  namespaceId,
  namespaceRevisionId = null,
  displayName = "Raccolta fixture",
  shortDescription = null,
  description = null,
  createdBy,
  contextId = null,
  semanticGraphId = null,
  graphRevisionId = null,
} = {}) {
  if (!contentSpace?._id) throw new Error("contentSpace obbligatorio per la fixture editoriale");
  if (!namespaceId) throw new Error("namespaceId obbligatorio per la fixture editoriale");
  if (!createdBy) throw new Error("createdBy obbligatorio per la fixture editoriale");

  const semanticGraph = await SemanticGraph.create({
    ...(semanticGraphId ? { _id: semanticGraphId } : {}),
    namespaceId,
    displayName: `${displayName} · Relazioni`,
    ownerType: contentSpace.ownerType,
    ownerId: contentSpace.ownerId,
    createdBy,
  });
  const graphRevision = await SemanticGraphRevision.create({
    ...(graphRevisionId ? { _id: graphRevisionId } : {}),
    semanticGraphId: semanticGraph._id,
    version: 1,
    basedOnRevisionId: null,
    authoredAgainstNamespaceRevisionId: namespaceRevisionId || objectId(),
    createdBy,
  });
  semanticGraph.workingRevisionId = graphRevision._id;
  semanticGraph.workingVersion = 1;
  await semanticGraph.save();

  const context = await EditorialContext.create({
    ...(contextId ? { _id: contextId } : {}),
    contentSpaceId: contentSpace._id,
    namespaceId,
    semanticGraphId: semanticGraph._id,
    displayName,
    shortDescription,
    description,
    createdBy,
  });

  return { context, semanticGraph, graphRevision };
}

module.exports = { createEditorialContextWithGraph };
