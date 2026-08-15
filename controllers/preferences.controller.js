const preferenceService = require("../services/userPreference.service");

async function setDefaultPreference(req, res, next) {
  try {
    const preference = await preferenceService.setUserDefaultPreference({ userId: req.user._id, payload: req.body });
    res.status(200).json({ preference });
  } catch (error) { next(error); }
}

async function setVisitPreference(req, res, next) {
  try {
    const preference = await preferenceService.setVisitPreference({ userId: req.user._id, visitId: req.params.visitId, payload: req.body });
    res.status(200).json({ preference });
  } catch (error) { next(error); }
}

async function getVisitPreference(req, res, next) {
  try {
    const preference = await preferenceService.getStoredVisitPreference({
      userId: req.user._id,
      visitId: req.params.visitId,
    });
    res.status(200).json({ preference });
  } catch (error) { next(error); }
}

async function getVisitPreferenceOptions(req, res, next) {
  try {
    res.status(200).json(await preferenceService.getVisitPreferenceOptions({
      userId: req.user._id,
      visitId: req.params.visitId,
    }));
  } catch (error) { next(error); }
}

async function getPresentationPlan(req, res, next) {
  try {
    res.status(200).json(await preferenceService.buildPresentationPlan({ userId: req.user._id, visitId: req.params.visitId }));
  } catch (error) { next(error); }
}

module.exports = { setDefaultPreference, setVisitPreference, getVisitPreference, getVisitPreferenceOptions, getPresentationPlan };
