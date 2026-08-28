function finite(value) { return typeof value === "number" && Number.isFinite(value); }

function validNormalizedPoint(point) {
  return Boolean(point && finite(point.x) && finite(point.y)
    && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1);
}

function pixelPoint(point, mapAsset) {
  if (!validNormalizedPoint(point) || !mapAsset || !finite(mapAsset.width) || !finite(mapAsset.height)) return null;
  return { x: point.x * mapAsset.width, y: point.y * mapAsset.height };
}

function pixelDistance(from, to, mapAsset) {
  const a = pixelPoint(from, mapAsset);
  const b = pixelPoint(to, mapAsset);
  if (!a || !b) return null;
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function polylinePixelLength(points, mapAsset) {
  if (!Array.isArray(points) || points.length < 2) return null;
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    const segment = pixelDistance(points[index - 1], points[index], mapAsset);
    if (!finite(segment)) return null;
    length += segment;
  }
  return length;
}

function deriveMetersPerPixel({ distanceMeters, points, mapAsset }) {
  const pixels = polylinePixelLength(points, mapAsset);
  if (!finite(distanceMeters) || distanceMeters <= 0 || !finite(pixels) || pixels <= 0) return null;
  return distanceMeters / pixels;
}

function distanceMetersForGeometry({ points, floor }) {
  const pixels = polylinePixelLength(points, floor?.mapAsset);
  const scale = floor?.calibration?.metersPerPixel;
  if (!finite(pixels) || !finite(scale) || scale <= 0) return null;
  return pixels * scale;
}

function samePoint(left, right, epsilon = 1e-6) {
  return validNormalizedPoint(left) && validNormalizedPoint(right)
    && Math.abs(left.x - right.x) <= epsilon
    && Math.abs(left.y - right.y) <= epsilon;
}

function nearlyEqual(left, right, epsilon = 1e-6) {
  if (!finite(left) || !finite(right)) return false;
  return Math.abs(left - right) <= epsilon * Math.max(1, Math.abs(left), Math.abs(right));
}

module.exports = {
  finite,
  validNormalizedPoint,
  pixelDistance,
  polylinePixelLength,
  deriveMetersPerPixel,
  distanceMetersForGeometry,
  samePoint,
  nearlyEqual,
};
