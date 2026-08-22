const preferenceService = require("../services/userPreference.service");

async function setDefaultPreference(req, res, next) {
  try {
    const preference = await preferenceService.setDefaultPresentationPreference({
      userId: req.user._id,
      payload: req.body,
    });
    res.status(200).json({ preference });
  } catch (error) { next(error); }
}

async function setDefaultNavigation(req, res, next) {
  try {
    const navigation = await preferenceService.setDefaultNavigationPreference({
      userId: req.user._id,
      payload: req.body,
    });
    res.status(200).json({ navigation });
  } catch (error) { next(error); }
}

async function setLearning(req, res, next) {
  try {
    const learningPreferences = await preferenceService.setLearningPreferences({
      userId: req.user._id,
      payload: req.body,
    });
    res.status(200).json({ learningPreferences });
  } catch (error) { next(error); }
}

async function profile(req, res, next) {
  try {
    res.status(200).json(await preferenceService.getAdaptiveProfile({ userId: req.user._id }));
  } catch (error) { next(error); }
}

async function reset(req, res, next) {
  try {
    res.status(200).json(await preferenceService.resetAdaptiveProfile({ userId: req.user._id }));
  } catch (error) { next(error); }
}

module.exports = {
  setDefaultPreference,
  setDefaultNavigation,
  setLearning,
  profile,
  reset,
};
