const fs = require("fs/promises");
const path = require("path");
const { randomUUID } = require("crypto");
const { decodePayload } = require("./itemMediaUpload.service");

const MAX_RECOGNITION_MEDIA_BYTES = 2 * 1024 * 1024;
const RECOGNITION_MEDIA_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"];
const PUBLIC_PREFIX = "/uploads/venue-recognition-media/";

function configuredRecognitionMediaRoot() {
  return process.env.VENUE_RECOGNITION_MEDIA_DIR
    ? path.resolve(process.env.VENUE_RECOGNITION_MEDIA_DIR)
    : path.join(__dirname, "..", "uploads", "venue-recognition-media");
}

async function storeVenueRecognitionMedia({ payload = {}, mediaRoot = configuredRecognitionMediaRoot() } = {}) {
  const decoded = decodePayload(payload, {
    maxBytes: MAX_RECOGNITION_MEDIA_BYTES,
    allowedMimeTypes: RECOGNITION_MEDIA_MIME_TYPES,
    maxBytesMessage: "Scegli un'immagine di massimo 2 MB",
  });
  await fs.mkdir(mediaRoot, { recursive: true });
  const fileName = `${randomUUID()}.${decoded.extension}`;
  await fs.writeFile(path.join(mediaRoot, fileName), decoded.buffer, { flag: "wx" });
  return {
    url: `${PUBLIC_PREFIX}${fileName}`,
    altText: String(payload.altText || "").trim().slice(0, 500) || null,
  };
}

async function removeVenueRecognitionMedia(url, { mediaRoot = configuredRecognitionMediaRoot() } = {}) {
  const normalized = String(url || "");
  if (!normalized.startsWith(PUBLIC_PREFIX)) return false;
  const relative = normalized.slice(PUBLIC_PREFIX.length);
  const fileName = path.basename(relative);
  if (!fileName || fileName !== relative) return false;
  try {
    await fs.unlink(path.join(mediaRoot, fileName));
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

module.exports = {
  MAX_RECOGNITION_MEDIA_BYTES,
  configuredRecognitionMediaRoot,
  storeVenueRecognitionMedia,
  removeVenueRecognitionMedia,
};