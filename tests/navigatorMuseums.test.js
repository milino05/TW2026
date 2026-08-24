const test = require("node:test");
const assert = require("node:assert/strict");

const { projectNavigatorMuseums } = require("../services/navigatorVisitV2.service");

const pinacotecaId = "496f78e51b8861a9800749a7";
const mamboId = "64b000000000000000000001";
const auroraId = "64b000000000000000000002";
const unavailableId = "64b000000000000000000003";

test("Navigator projects unique owned museums with visit and resumable-session counts", () => {
  const museums = projectNavigatorMuseums([
    {
      id: "visit-multi-venue",
      physicalScope: [
        { id: pinacotecaId, name: "Pinacoteca Nazionale di Bologna", description: "Via Belle Arti" },
        { id: mamboId, name: "MAMbo", description: "Via Don Minzoni" },
        { id: pinacotecaId, name: "Pinacoteca Nazionale di Bologna", description: "Duplicato nella stessa visita" },
      ],
    },
    {
      id: "visit-pinacoteca",
      physicalScope: [
        { id: pinacotecaId, name: "Pinacoteca Nazionale di Bologna", description: "Via Belle Arti" },
      ],
    },
    {
      id: "visit-aurora",
      physicalScope: [
        { id: auroraId, name: "Museo Aurora", description: "Configurazione di esempio" },
      ],
    },
  ], [
    {
      id: "session-pinacoteca",
      physicalScope: [{ id: pinacotecaId, name: "Pinacoteca Nazionale di Bologna" }],
    },
    {
      id: "session-multi-venue",
      physicalScope: [
        { id: pinacotecaId, name: "Pinacoteca Nazionale di Bologna" },
        { id: mamboId, name: "MAMbo" },
      ],
    },
    {
      id: "session-without-owned-visit",
      physicalScope: [{ id: unavailableId, name: "Museo non posseduto" }],
    },
  ]);

  assert.deepEqual(
    museums.map((museum) => ({
      id: String(museum.id),
      name: museum.name,
      visitCount: museum.visitCount,
      resumableSessionCount: museum.resumableSessionCount,
    })),
    [
      {
        id: mamboId,
        name: "MAMbo",
        visitCount: 1,
        resumableSessionCount: 1,
      },
      {
        id: auroraId,
        name: "Museo Aurora",
        visitCount: 1,
        resumableSessionCount: 0,
      },
      {
        id: pinacotecaId,
        name: "Pinacoteca Nazionale di Bologna",
        visitCount: 2,
        resumableSessionCount: 2,
      },
    ],
  );
});
