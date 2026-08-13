const museumService = require("../services/museum.service");
const vocabularyService = require("../services/museumVocabulary.service");
const vocabularyRevisionService = require("../services/museumVocabularyRevision.service");

async function createMuseum(req, res, next) {
  let museum = null;
  try {
    museum = await museumService.createMuseum({ payload: req.body, actorUserId: req.user._id });
    await vocabularyRevisionService.createInitialVocabularyForMuseum({ museumId: museum._id, actorUserId: req.user._id, config: req.body?.config || museum.config || {} });
    res.status(201).json(museum);
  } catch (error) {
    if (museum?._id) {
      await vocabularyRevisionService.deleteVocabularyForMuseum({ museumId: museum._id }).catch(() => {});
      await museumService.deleteMuseum({ museumId: museum._id, actorUserId: req.user._id }).catch(() => {});
    }
    next(error);
  }
}
async function updateMuseum(req, res, next) {
  try {
    let vocabularyDraft = null;
    if (req.body?.config && typeof req.body.config === "object") vocabularyDraft = await vocabularyRevisionService.updateVocabularyDraft({ museumId: req.params.museumId, payload: req.body.config, userId: req.user._id });
    const museumPayload = { ...req.body }; delete museumPayload.config;
    const result = Object.keys(museumPayload).length ? await museumService.updateMuseum({ museumId: req.params.museumId, payload: museumPayload, actorUserId: req.user._id }) : { museum: await museumService.getMuseumById({ museumId: req.params.museumId }), audit: null };
    res.status(200).json({ ...result, vocabularyDraft });
  } catch (error) { next(error); }
}
async function assignMuseumRole(req, res, next) { try { res.status(200).json(await museumService.assignMuseumRole({ museumId: req.params.museumId, targetUserId: req.params.userId, role: req.body?.role, actorUserId: req.user._id })); } catch (error) { next(error); } }
async function assignMuseumRoleByUsername(req, res, next) { try { res.status(200).json(await museumService.assignMuseumRoleByUsername({ museumId: req.params.museumId, username: req.body?.username, role: req.body?.role, actorUserId: req.user._id })); } catch (error) { next(error); } }
async function removeMuseumMember(req, res, next) { try { res.status(200).json(await museumService.removeMuseumMember({ museumId: req.params.museumId, targetUserId: req.params.userId, actorUserId: req.user._id })); } catch (error) { next(error); } }
async function listMuseums(req, res, next) { try { res.status(200).json(await museumService.listMuseums()); } catch (error) { next(error); } }
async function getMuseum(req, res, next) { try { res.status(200).json(await museumService.getMuseumById({ museumId: req.params.museumId })); } catch (error) { next(error); } }
async function deleteMuseum(req, res, next) { try { const museum = await museumService.deleteMuseum({ museumId: req.params.museumId, actorUserId: req.user._id }); await vocabularyRevisionService.deleteVocabularyForMuseum({ museumId: museum._id }); res.status(200).json({ message: "Museo eliminato", museumId: museum._id }); } catch (error) { next(error); } }
async function getEditorVocabulary(req, res, next) { try { res.status(200).json(await vocabularyService.getMuseumVocabulary(req.params.museumId)); } catch (error) { next(error); } }
async function getItemTypeVocabulary(req, res, next) { try { res.status(200).json(await vocabularyService.getItemTypeVocabulary({ museumId: req.params.museumId, itemType: req.params.itemType })); } catch (error) { next(error); } }
module.exports = { createMuseum, updateMuseum, assignMuseumRole, assignMuseumRoleByUsername, removeMuseumMember, listMuseums, getMuseum, deleteMuseum, getEditorVocabulary, getItemTypeVocabulary };
