function id(value) { return String(value?._id || value?.id || value || ""); }
function pct(value) { return Math.max(0, Math.min(100, Number(value ?? .5) * 100)); }

function connectionPointList(layout, connection, draggedPlaceId, draggedPoint) {
  const places = layout?.places || [];
  const from = places.find((entry) => id(entry._id) === id(connection.fromPlaceId));
  const to = places.find((entry) => id(entry._id) === id(connection.toPlaceId));
  if (!from || !to) return null;

  const points = connection.geometry?.points?.length
    ? connection.geometry.points.map((point) => ({ x: Number(point.x), y: Number(point.y) }))
    : [
        { x: Number(from.position?.x), y: Number(from.position?.y) },
        { x: Number(to.position?.x), y: Number(to.position?.y) },
      ];

  if (id(connection.fromPlaceId) === id(draggedPlaceId)) points[0] = draggedPoint;
  if (id(connection.toPlaceId) === id(draggedPlaceId)) points[points.length - 1] = draggedPoint;

  return points.map((point) => `${pct(point.x)},${pct(point.y)}`).join(" ");
}

export const venueLiveConnectionPreviewMixin = {
  onMapLiveConnectionPreview(event) {
    const drag = this.draggingPlace;
    if (!drag || drag.pointerId !== event.pointerId || !drag.moved) return;
    const layout = this.data?.layout;
    if (!layout || !drag.point) return;

    for (const connection of layout.connections || []) {
      const incident = id(connection.fromPlaceId) === id(drag.placeId)
        || id(connection.toPlaceId) === id(drag.placeId);
      if (!incident) continue;

      const pointList = connectionPointList(layout, connection, drag.placeId, drag.point);
      if (!pointList) continue;
      const hit = this.querySelector(`[data-map-connection="${CSS.escape(id(connection._id))}"]`);
      if (!hit) continue;

      hit.setAttribute("points", pointList);
      const line = hit.previousElementSibling;
      if (line?.classList.contains("connection-line")) line.setAttribute("points", pointList);
    }
  },
};
