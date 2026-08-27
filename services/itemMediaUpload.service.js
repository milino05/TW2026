const fs = require("fs/promises");
const path = require("path");
const { randomUUID } = require("crypto");
const AppError = require("../utils/AppError");

const MAX_MEDIA_BYTES = 700 * 1024;
const MEDIA_TYPES = {
  "image/jpeg": { extension: "jpg", signature: (buffer) => buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff },
  "image/png": { extension: "png", signature: (buffer) => buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  "image/webp": { extension: "webp", signature: (buffer) => buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP" },
  "image/avif": { extension: "avif", signature: (buffer) => buffer.subarray(4, 12).toString("ascii").startsWith("ftypavi") },
};

function configuredMediaRoot() {
  return process.env.ITEM_MEDIA_DIR
    ? path.resolve(process.env.ITEM_MEDIA_DIR)
    : path.join(__dirname, "..", "uploads", "item-media");
}

function decodePayload(payload = {}) {
  const mimeType = String(payload.mimeType || "").trim().toLowerCase();
  const type = MEDIA_TYPES[mimeType];
  if (!type) {
    throw new AppError("Formato immagine non supportato", 400, [{
      field: "mimeType",
      code: "UNSUPPORTED_MEDIA_TYPE",
      message: "Usa un'immagine JPEG, PNG, WebP o AVIF",
    }]);
  }
  const encoded = String(payload.dataBase64 || "").replace(/^data:[^;]+;base64,/, "").trim();
  if (!encoded || !/^[a-z0-9+/]+={0,2}$/i.test(encoded)) {
    throw new AppError("Immagine non valida", 400, [{ field: "dataBase64", code: "INVALID_IMAGE_DATA" }]);
  }
  const buffer = Buffer.from(encoded, "base64");
  if (!buffer.length || !type.signature(buffer)) {
    throw new AppError("Il contenuto del file non corrisponde al formato indicato", 400, [{ field: "dataBase64", code: "INVALID_IMAGE_SIGNATURE" }]);
  }
  if (buffer.length > MAX_MEDIA_BYTES) {
    throw new AppError("L'immagine è troppo grande", 413, [{
      field: "dataBase64",
      code: "MEDIA_TOO_LARGE",
      message: "Scegli un'immagine di massimo 700 KB",
    }]);
  }
  return { buffer, mimeType, extension: type.extension };
}

async function storeItemMedia({ payload = {}, mediaRoot = configuredMediaRoot() } = {}) {
  const { buffer, mimeType, extension } = decodePayload(payload);
  await fs.mkdir(mediaRoot, { recursive: true });
  const fileName = `${randomUUID()}.${extension}`;
  await fs.writeFile(path.join(mediaRoot, fileName), buffer, { flag: "wx" });
  return {
    url: `/uploads/item-media/${fileName}`,
    altText: String(payload.altText || "").trim() || null,
    mimeType,
    source: {
      provider: "author_upload",
      fileTitle: String(payload.fileName || "").trim().slice(0, 255) || fileName,
      retrievedAt: new Date(),
    },
  };
}

module.exports = { MAX_MEDIA_BYTES, configuredMediaRoot, decodePayload, storeItemMedia };
