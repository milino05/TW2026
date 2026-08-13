const service = require("../services/museumVocabularyRevision.service");

async function get(req, res, next) {
  try {
    const view = req.query.view === "working" ? "working" : "published";
    const result = await service.getVocabularyRevision({ museumId: req.params.museumId, userId: req.user?._id || null, view });
    res.status(200).json(result);
  } catch (error) { next(error); }
}
async function update(req, res, next) { try { res.status(200).json(await service.updateVocabularyDraft({ museumId: req.params.museumId, payload: req.body, userId: req.user._id })); } catch (error) { next(error); } }
async function check(req, res, next) { try { res.status(200).json(await service.evaluateVocabulary({ museumId: req.params.museumId, userId: req.user._id })); } catch (error) { next(error); } }
async function requestReview(req, res, next) { try { res.status(200).json(await service.requestVocabularyReview({ museumId: req.params.museumId, userId: req.user._id })); } catch (error) { next(error); } }
async function withdrawReview(req, res, next) { try { res.status(200).json(await service.withdrawVocabularyReview({ museumId: req.params.museumId, userId: req.user._id })); } catch (error) { next(error); } }
async function requestChanges(req, res, next) { try { res.status(200).json(await service.requestVocabularyChanges({ museumId: req.params.museumId, userId: req.user._id, message: req.body?.message })); } catch (error) { next(error); } }
async function publish(req, res, next) { try { res.status(200).json(await service.publishVocabulary({ museumId: req.params.museumId, userId: req.user._id })); } catch (error) { next(error); } }

module.exports = { get, update, check, requestReview, withdrawReview, requestChanges, publish };
