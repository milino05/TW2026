const AppError = require("../utils/AppError");
const { findItemOrFail, assertCanManageItem } = require("./itemV2.service");
const {
  normalizeRecognitionMedia,
  validateRecognitionMediaPayload,
} = require("./validation/itemV2.validation");

async function updateItemRecognitionMedia({ itemId, payload = {}, actorUserId }) {
  const issues = validateRecognitionMediaPayload(payload);
  if (issues.length) throw new AppError("Payload recognition media non valido", 400, issues);
  const item = await findItemOrFail(itemId);
  await assertCanManageItem(item, actorUserId, "item.edit");
  item.recognitionMedia = payload.recognitionMedia === null
    ? null
    : normalizeRecognitionMedia(payload.recognitionMedia);
  await item.save();
  return { item };
}

module.exports = { updateItemRecognitionMedia };
