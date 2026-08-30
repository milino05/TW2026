const fs = require("fs/promises");
const path = require("path");
const { configuredFloorPlanRoot } = require("../services/venueFloorPlanUpload.service");

const PLAYGROUND_MAP_WIDTH = 1000;
const PLAYGROUND_MAP_HEIGHT = 300;
const PLAYGROUND_MAP_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAA+gAAAEsCAAAAAB1LsazAAADzUlEQVR42u3dMVICQRRF0b86FmEya59FdG5pIiqWgXQ77/c5odmjuVI1DFA3oL3yEIDQAaEDQgcuFPoAmhI6CB0QOiB0QOiA0AGhA0IHhA5CB4QOCB0QOiB0QOiA0AGhg9A9GCB0QOiA0AGhA0IHhA4IHYQudBA6IHRA6IDQAaEDQgeEDggdhA4IHRA6IHRA6IDQAaEDQgehA0IHhA4IHRA6IHRA6IDQQehCB6EDQgeEDggdEDogdEDogNBB6IDQAaEDQgeEDggdEDogdBA6IHRA6IDQAaEDQgeEDggdhC50EDogdEDogNABoQNCB4QOCB2EDggdEDogdEDogNABoQNCB6EDQgeEDggdEDogdEDogNBB6EIHoQNCB4QOCB0QOiB0QOiA0EHogNABoQNCB4QOCB0QOiB0EDogdEDogNABoQNCB4QO/Bb6CbQndBD6cxxNHiw77EjdMTv040P2WdhhR/KOWrQi+kzssCN9R63cEXoidtgRv6NWzog8EjvsaLCjVuwYwSdihx0ddtTkHXfv20eeiB12tNhRy3ZEnogddvTYMTX0bzfjhR6IHXak76jZO45P/7zCTsQOO5rsqFU7Ek/EDju67Jgb+pe3DmIPxA47wnfMC308HDLiDsQOOxrsqIU70k7EDjva7JgZ+oP7fiIPxA474ncI3Q47hD5ryEsCO+z4px1C98SyQ+jXCP3naw13fw46DzvsWL7DK7pXEDu8ogvdE8sOobvqbocdrro7EDvsEPoTrsa5g8kOO9rcGeeeZDvsuNgOn16zw44Ndvg8uh12bLDDN8zYYccGO3xnnB12bLDDt8DaYccGO3yvux12bLDDL7XYYccGO/z2mh12bLDDr6naYccGO/w+uh12bLCj1m05k9lhR/SOWrLm7MEOO1J31Am0J3TYIfTbmwE09Z640EHogNABoQNCB4QOCB0QOiB0EDogdEDogNABoQNCB4QOCB2EDggdEDogdEDogNABoQNCB6ELHYQOCB0QOiB0QOiA0AGhA0IHoQNCB4QOCB0QOiB0QOiA0EHogNABoQNCB4QOCB0QOiB0ELrQQeiA0AGhA0IHhA4IHRA6IHQQOiB0QOiA0AGhA0IHhA4IHYQOCB0QOiB0QOiA0AGhA0IHoQsdhA4IHRA6IHRA6IDQAaEDQgehA0IHhA4IHRA6IHRA6IDQQeiA0AGhA0IHhA4IHRA6IHQQutBB6IDQAaEDQgeEDggdEDogdBA6IHRA6IDQAaEDQgeEDggdhA4IHRA6IHRA6IDQgT+GDrQmdBA6IHRA6MA1vAKi2ayogxgS8gAAAABJRU5ErkJggg==";

async function ensureVisitAuthoringPlaygroundMap({ scope, floorPlanRoot = configuredFloorPlanRoot() }) {
  const safeScope = String(scope || "").trim();
  if (!/^[0-9a-f]{24}$/i.test(safeScope)) throw new Error("Scope playground non valido");

  const fileName = `visit-authoring-playground-${safeScope}.png`;
  await fs.mkdir(floorPlanRoot, { recursive: true });
  await fs.writeFile(path.join(floorPlanRoot, fileName), Buffer.from(PLAYGROUND_MAP_BASE64, "base64"));

  return {
    url: `/uploads/venue-floor-plans/${fileName}`,
    mimeType: "image/png",
    width: PLAYGROUND_MAP_WIDTH,
    height: PLAYGROUND_MAP_HEIGHT,
    originalName: "planimetria-playground-visite.png",
  };
}

module.exports = {
  PLAYGROUND_MAP_WIDTH,
  PLAYGROUND_MAP_HEIGHT,
  ensureVisitAuthoringPlaygroundMap,
};
