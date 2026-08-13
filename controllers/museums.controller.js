const museumService = require("../services/museum.service");
const vocabularyService = require("../services/museumVocabulary.service");
const vocabularyRevisionService = require("../services/museumVocabularyRevision.service");

async function createMuseum(req, res, next) {
  let museum = null;
  try {
    const museumPayload = {
      name: req.body?.name,
      ...(Object.prototype.hasOwnProperty.call(req.body || {}, "config") ? { config: req.body.config } : {}),
      ...(Object.prototype.hasOwnProperty.call(req.body || {}, "vocabularyRevision") ? { vocabularyRevision: req.body.vocabularyRevision } : {}),
    };
    museum = await museumService.createMuseum({ payload: museumPayload, actorUserId: req.user._id });
    const vocabulary = await vocabularyRevisionService.createInitialVocabularyForMuseum({
      museumId: museum._id,
      actorUserId: req.user._id,
      initialPayload: req.body?.vocabulary || null,
    });
    res.status(201).json({ museum, vocabulary });
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
    res.status(200).json(await museumService.updateMuseum({ museumId: req.params.museumId, payload: req.body || {}, actorUserId: req.user._id }));
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

module.exports = {
  createMuseum,
  updateMuseum,
  assignMuseumRole,
  assignMuseumRoleByUsername,
  removeMuseumMember,
  listMuseums,
  getMuseum,
  deleteMuseum,
  getEditorVocabulary,
  getItemTypeVocabulary,
};
