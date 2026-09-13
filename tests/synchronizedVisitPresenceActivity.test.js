const test = require("node:test");
const assert = require("node:assert/strict");
const {
  aggregateConnectionActivity,
  normalizeParticipantActivity,
} = require("../services/synchronizedVisitRealtime.service");

test("participant activity normalizza soltanto segnali osservabili supportati", () => {
  assert.deepEqual(
    normalizeParticipantActivity({ activity: "active", mode: "reading" }),
    { activity: "active", mode: "reading" },
  );
  assert.deepEqual(
    normalizeParticipantActivity({ activity: "active", mode: "audio" }),
    { activity: "active", mode: "audio" },
  );
  assert.deepEqual(
    normalizeParticipantActivity({ activity: "active", mode: "unknown" }),
    { activity: "inactive", mode: null },
  );
  assert.deepEqual(
    normalizeParticipantActivity({ activity: "inactive", mode: "audio" }),
    { activity: "inactive", mode: null },
  );
});

test("presence aggregata resta attiva se almeno una connessione sta fruendo e privilegia audio", () => {
  assert.deepEqual(
    aggregateConnectionActivity(new Map([
      ["tab-a", { activity: "inactive", mode: null }],
      ["tab-b", { activity: "active", mode: "reading" }],
    ])),
    { activity: "active", mode: "reading" },
  );

  assert.deepEqual(
    aggregateConnectionActivity(new Map([
      ["tab-a", { activity: "active", mode: "reading" }],
      ["tab-b", { activity: "active", mode: "audio" }],
    ])),
    { activity: "active", mode: "audio" },
  );

  assert.deepEqual(
    aggregateConnectionActivity(new Map([
      ["tab-a", { activity: "inactive", mode: null }],
      ["tab-b", { activity: "inactive", mode: null }],
    ])),
    { activity: "inactive", mode: null },
  );
});
