const User = require("../models/user");
const UserAdaptiveProfile = require("../models/userAdaptiveProfile.model");
const UserVisitPreference = require("../models/userVisitPreference.model");
const logistics = require("../services/logisticsPlan.service");

function normalizeNavigation(payload = {}) {
  return {
    movementPacePreference: Number.isFinite(Number(payload.movementPacePreference))
      ? Math.max(0, Math.min(1, Number(payload.movementPacePreference)))
      : 0.5,
    requirements: Array.isArray(payload.requirements) ? payload.requirements : [],
  };
}

async function setLearning(req, res, next) {
  try {
    const enabled = req.body?.enabled === true;
    const user = await User.findByIdAndUpdate(req.user._id, { $set: { adaptiveLearningEnabled: enabled } }, { new: true });
    res.json({ adaptiveLearningEnabled: user.adaptiveLearningEnabled });
  } catch (error) { next(error); }
}

async function profile(req, res, next) {
  try {
    res.json({
      adaptiveLearningEnabled: req.user.adaptiveLearningEnabled === true,
      profile: await UserAdaptiveProfile.findOne({ userId: req.user._id }).lean(),
    });
  } catch (error) { next(error); }
}

async function reset(req, res, next) {
  try {
    await UserAdaptiveProfile.deleteOne({ userId: req.user._id });
    res.json({ reset: true });
  } catch (error) { next(error); }
}

async function setDefaultNavigation(req, res, next) {
  try {
    const navigation = normalizeNavigation(req.body);
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { $set: { defaultNavigationPreference: navigation } },
      { new: true, runValidators: true },
    );
    res.json({ navigation: user.defaultNavigationPreference });
  } catch (error) { next(error); }
}

async function setVisitNavigation(req, res, next) {
  try {
    const navigation = normalizeNavigation(req.body);
    const preference = await UserVisitPreference.findOneAndUpdate(
      { userId: req.user._id, visitId: req.params.visitId },
      { $set: { navigation } },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
    );
    res.json({ navigation: preference.navigation });
  } catch (error) { next(error); }
}

async function logisticsPlan(req, res, next) {
  try {
    res.json(await logistics.buildLogisticsPlan({ userId: req.user._id, visitId: req.params.visitId }));
  } catch (error) { next(error); }
}

module.exports = { setLearning, profile, reset, setDefaultNavigation, setVisitNavigation, logisticsPlan };
