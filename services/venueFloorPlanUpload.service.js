const fs = require("fs/promises");
const path = require("path");
const { randomUUID } = require("crypto");
const AppError = require("../utils/AppError");
const { decodePayload } = require("./itemMediaUpload.service");

const MAX_FLOOR_PLAN_BYTES = 4 * 1024 * 1024;
const FLOOR_PLAN_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];
const PUBLIC_PREFIX = "/uploads/venue-floor-plans/";

function configuredFloorPlanRoot() {
  return process.env.VENUE_FLOOR_PLAN_DIR
    ? path.resolve(process.env.VENUE_FLOOR_PLAN_DIR)
    : path.join(__dirname, "..", "uploads", "venue-floor-plans");
}

function jpegDimensions(buffer) {
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) { offset += 1; continue; }
    const marker = buffer[offset + 1];
    offset += 2;
    if ([0xd8, 0xd9].includes(marker)) continue;
    if (marker === 0xda) break;
    if (offset + 2 > buffer.length) break;
    const length = buffer.readUInt16BE(offset);
    if (length < 2 || offset + length > buffer.length) break;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      if (length < 7) break;
      return { width: buffer.readUInt16BE(offset + 5), height: buffer.readUInt16BE(offset + 3) };
    }
    offset += length;
  }
  return null;
}

function webpDimensions(buffer) {
  if (buffer.length < 30) return null;
  const chunk = buffer.subarray(12, 16).toString("ascii");
  if (chunk === "VP8X") {
    const width = 1 + buffer.readUIntLE(24, 3);
    const height = 1 + buffer.readUIntLE(27, 3);
    return { width, height };
  }
  if (chunk === "VP8L" && buffer[20] === 0x2f) {
    const b1 = buffer[21];
    const b2 = buffer[22];
    const b3 = buffer[23];
    const b4 = buffer[24];
    return {
      width: 1 + (((b2 & 0x3f) << 8) | b1),
      height: 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6)),
    };
  }
  if (chunk === "VP8 " && buffer.subarray(23, 26).equals(Buffer.from([0x9d, 0x01, 0x2a]))) {
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff,
    };
  }
  return null;
}

function imageDimensions(buffer, mimeType) {
  if (mimeType === "image/png" && buffer.length >= 24) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (mimeType === "image/jpeg") return jpegDimensions(buffer);
  if (mimeType === "image/webp") return webpDimensions(buffer);
  return null;
}

function assertDimensions(dimensions) {
  if (!dimensions || !Number.isInteger(dimensions.width) || !Number.isInteger(dimensions.height)
    || dimensions.width < 1 || dimensions.height < 1 || dimensions.width > 20000 || dimensions.height > 20000) {
    throw new AppError("Dimensioni della planimetria non leggibili", 400, [{
      field: "dataBase64",
      code: "INVALID_IMAGE_DIMENSIONS",
      message: "Usa una planimetria JPEG, PNG o WebP valida",
    }]);
  }
}

async function storeVenueFloorPlan({ payload = {}, floorPlanRoot = configuredFloorPlanRoot() } = {}) {
  const decoded = decodePayload(payload, {
    maxBytes: MAX_FLOOR_PLAN_BYTES,
    allowedMimeTypes: FLOOR_PLAN_MIME_TYPES,
    maxBytesMessage: "Scegli una planimetria di massimo 4 MB",
  });
  const dimensions = imageDimensions(decoded.buffer, decoded.mimeType);
  assertDimensions(dimensions);
  await fs.mkdir(floorPlanRoot, { recursive: true });
  const fileName = `${randomUUID()}.${decoded.extension}`;
  await fs.writeFile(path.join(floorPlanRoot, fileName), decoded.buffer, { flag: "wx" });
  return {
    url: `${PUBLIC_PREFIX}${fileName}`,
    mimeType: decoded.mimeType,
    width: dimensions.width,
    height: dimensions.height,
    originalName: String(payload.fileName || "").trim().slice(0, 255) || fileName,
  };
}

async function removeVenueFloorPlan(url, { floorPlanRoot = configuredFloorPlanRoot() } = {}) {
  const normalized = String(url || "");
  if (!normalized.startsWith(PUBLIC_PREFIX)) return false;
  const fileName = path.basename(normalized.slice(PUBLIC_PREFIX.length));
  if (!fileName || fileName !== normalized.slice(PUBLIC_PREFIX.length)) return false;
  try {
    await fs.unlink(path.join(floorPlanRoot, fileName));
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

module.exports = {
  MAX_FLOOR_PLAN_BYTES,
  FLOOR_PLAN_MIME_TYPES,
  configuredFloorPlanRoot,
  storeVenueFloorPlan,
  removeVenueFloorPlan,
};