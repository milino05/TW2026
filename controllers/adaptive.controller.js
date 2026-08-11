const User = require("../models/user");
const UserAdaptiveProfile = require("../models/userAdaptiveProfile.model");
const UserVisitPreference = require("../models/userVisitPreference.model");
const VisitSession = require("../models/visitSession.model");
const logistics = require("../services/logisticsPlan.service");
const { contributorHash } = require("../services/contributorIdentity.service");
const { removeContributor } = require("../services/collectiveLearning.service");
const policy = require("../config/adaptivePolicy");

function normalizeNavigation(payload = {}) {
  return {
    movementPacePreference: Number.isFinite(Number(payload.movementPacePreference)) ? Math.max(0, Math.min(1, Number(payload.movementPacePreference))) : 0.5,
    requirements: Array.isArray(payload.requirements) ? payload.requirements : [],
  };
}

async function setLearning(req, res, next) {
  try {
    const update = {};
    if (typeof req.body?.personalHistory === "boolean") update["learningPreferences.personalHistory"] = req.body.personalHistory;
    if (typeof req.body?.collectiveContribution === "boolean") {
      if (req.body.collectiveContribution === true) contributorHash(req.user._id);
      update["learningPreferences.collectiveContribution"] = req.body.collectiveContribution;
    }
    if (typeof req.body?.enabled === "boolean" && Object.keys(update).length === 0) {
      if (req.body.enabled === true) contributorHash(req.user._id);
      update["learningPreferences.personalHistory"] = req.body.enabled;
      update["learningPreferences.collectiveContribution"] = req.body.enabled;
    }
    if (Object.keys(update).length === 0) return res.status(400).json({ message: "Specificare personalHistory e/o collectiveContribution" });
    update["learningPreferences.decidedAt"] = new Date();
    const user = await User.findByIdAndUpdate(req.user._id, { $set: update }, { new: true, runValidators: true });
    res.json({ learningPreferences: user.learningPreferences });
  } catch (error) { next(error); }
}

async function profile(req, res, next) {
  try {
    const user = await User.findById(req.user._id).lean();
    res.json({
      learningPreferences: user?.learningPreferences || null,
      decisionRequired: user?.learningPreferences?.personalHistory == null || user?.learningPreferences?.collectiveContribution == null,
      adaptivePolicyVersion: policy.version,
      profile: await UserAdaptiveProfile.findOne({ userId: req.user._id }).lean(),
    });
  } catch (error) { next(error); }
}

async function reset(req, res, next) {
  try {
    await Promise.all([
      UserAdaptiveProfile.deleteOne({ userId: req.user._id }),
      VisitSession.updateMany({ userId: req.user._id, status: { $ne: "active" } }, { $set: { transitionObservations: [], stopObservations: [] } }),
      removeContributor(req.user._id),
    ]);
    res.json({ reset: true, note: "Profilo personale, osservazioni storiche e contributi pseudonimi rimossi. Gli aggregati di popolazione gia derivati non vengono retroattivamente ricostruiti." });
  } catch (error) { next(error); }
}

async function setDefaultNavigation(req, res, next) {
  try {
    const navigation = normalizeNavigation(req.body);
    const user = await User.findByIdAndUpdate(req.user._id, { $set: { defaultNavigationPreference: navigation } }, { new: true, runValidators: true });
    res.json({ navigation: user.defaultNavigationPreference });
  } catch (error) { next(error); }
}

async function setVisitNavigation(req, res, next) {
  try {
    const navigation = normalizeNavigation(req.body);
    const preference = await UserVisitPreference.findOneAndUpdate({ userId: req.user._id, visitId: req.params.visitId }, { $set: { navigation } }, { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true });
    res.json({ navigation: preference.navigation });
  } catch (error) { next(error); }
}

async function logisticsPlan(req, res, next) {
  try { res.json(await logistics.buildLogisticsPlan({ userId: req.user._id, visitId: req.params.visitId })); } catch (error) { next(error); }
}

module.exports = { setLearning, profile, reset, setDefaultNavigation, setVisitNavigation, logisticsPlan };
