const test = require("node:test");
const assert = require("node:assert/strict");
const { pausedSeconds, activeElapsedSeconds } = require("../services/visitSession.service");

test("le pause non contaminano il tempo effettivo di visita", () => {
  const session = { startedAt: new Date("2026-01-01T10:00:00Z"), pauseIntervals: [{ startedAt: new Date("2026-01-01T10:10:00Z"), endedAt: new Date("2026-01-01T10:20:00Z") }] };
  const now = new Date("2026-01-01T10:30:00Z");
  assert.equal(pausedSeconds(session, now), 600);
  assert.equal(activeElapsedSeconds(session, now), 1200);
});
