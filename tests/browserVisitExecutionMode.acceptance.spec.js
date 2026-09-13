const { test, expect } = require("@playwright/test");

const BASE_URL = process.env.ARTAROUND_ACCEPTANCE_BASE_URL || "http://127.0.0.1:8000";
const VENUE_ID = "496f78e51b8861a9800749a7";
const VISIT_ID = "507f1f77bcf86cd799439011";
const REVISION_ID = "507f191e810c19729de860ea";

function preparation({ version = 1, mode = "self_guided", alias = null, status = "active" } = {}) {
  return {
    id: "prep-1",
    version,
    status,
    source: {
      sourceType: "visit",
      visitId: VISIT_ID,
      visitRevisionId: REVISION_ID,
      generatedVisitPlanId: null,
      versionPolicy: "follow_current",
    },
    executionMode: mode,
    availableExecutionModes: ["self_guided", "synchronized"],
    groupSessionSetup: { requestedJoinAlias: mode === "synchronized" ? (alias || "Fenice rossa") : null },
    effectivePresentationPreference: {
      depthPreference: 0.5,
      languageComplexityPreference: 0.5,
      locale: "it-IT",
    },
    navigation: {
      movementPacePreference: 0.5,
      routingProfileSelections: [],
      profilesByVenue: [],
    },
    preVisit: {
      visitNotes: ["Ritrovo all'ingresso."],
      venues: [{ id: VENUE_ID, name: "Museo Test", information: [] }],
    },
    readiness: { status: "ready", blockers: [], warnings: [] },
    logisticsPreview: {
      estimatedTotalSeconds: 1200,
      breakdown: { contentSeconds: 900, observationSeconds: 180, travelSeconds: 120 },
      reservedSeconds: 0,
      routeSummary: { stopCount: 3, legCount: 2, venueCount: 1, interVenueLegCount: 0 },
      warnings: [],
    },
    expiresAt: "2026-09-13T23:59:00.000Z",
    sessionId: status === "consumed" ? "host-session" : null,
    synchronizedSessionId: status === "consumed" && mode === "synchronized" ? "sync-1" : null,
  };
}

function runtimeProjection(mode = "self_guided") {
  return {
    session: {
      id: "host-session",
      status: "active",
      sourceType: "visit",
      currentEntryIndex: 0,
      runtimeVersion: 1,
      executionMode: mode,
    },
    synchronization: mode === "synchronized" ? {
      id: "sync-1",
      status: "lobby",
      role: "host",
      joinAlias: "Aquila verde",
      currentEntryIndex: 0,
      runtimeVersion: 1,
    } : null,
    planRevisionId: "plan-1",
    current: null,
    availableActions: [],
  };
}

function synchronizedProjection(alias = "Aquila verde") {
  return {
    synchronizedSession: {
      id: "sync-1",
      visitId: VISIT_ID,
      visitRevisionId: REVISION_ID,
      title: "Classe alla Pinacoteca",
      joinAlias: alias,
      status: "lobby",
      currentEntryIndex: 0,
      contentEntryCount: 3,
      runtimeVersion: 1,
      playback: { state: "idle", contentEntryId: null, commandVersion: 0, changedAt: null },
      participantCount: 0,
      quizQuestionCount: 3,
    },
    membership: {
      id: "membership-host",
      role: "host",
      status: "active",
      visitSessionId: "host-session",
      joinedAt: "2026-09-13T20:00:00.000Z",
    },
    participants: [],
  };
}

async function installNavigatorMocks(page) {
  let state = preparation();
  const patches = [];
  const starts = [];

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    const fulfill = (body, status = 200) => route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });

    if (path === "/api/auth/me" && method === "GET") {
      return fulfill({ user: { _id: "507f1f77bcf86cd799439012", username: "docente", status: "active" } });
    }
    if (path === "/api/v2/navigator/museums" && method === "GET") {
      return fulfill({ museums: [{ id: VENUE_ID, name: "Museo Test", description: "", visitCount: 1, resumableSessionCount: 0 }] });
    }
    if (path === `/api/v2/navigator/visits/${VISIT_ID}` && method === "GET") {
      return fulfill({
        context: { owner: { type: "organization", id: "507f1f77bcf86cd799439013", name: "Museo Test" } },
        visit: {
          id: VISIT_ID,
          resolvedRevisionId: REVISION_ID,
          title: "Classe alla Pinacoteca",
          description: "Percorso di prova",
          physicalScope: [{ id: VENUE_ID, name: "Museo Test", description: "" }],
          stopCount: 3,
          contentCount: 3,
          quizQuestionCount: 3,
        },
        preparation: { available: true },
      });
    }
    if (path === "/api/v2/execution-preparations" && method === "POST") {
      const body = request.postDataJSON();
      expect(body).toEqual({ visitId: VISIT_ID, executionMode: "self_guided" });
      state = preparation();
      return fulfill({ preparation: state });
    }
    if (path === "/api/v2/execution-preparations/prep-1" && method === "PATCH") {
      const body = request.postDataJSON();
      patches.push(body);
      const nextMode = body.executionMode || state.executionMode;
      const nextAlias = body.groupSessionSetup?.requestedJoinAlias !== undefined
        ? body.groupSessionSetup.requestedJoinAlias
        : state.groupSessionSetup.requestedJoinAlias;
      state = preparation({
        version: state.version + 1,
        mode: nextMode,
        alias: nextMode === "synchronized" ? (nextAlias || "Fenice rossa") : null,
      });
      return fulfill({ preparation: state });
    }
    if (path === "/api/v2/execution-preparations/prep-1/start" && method === "POST") {
      const body = request.postDataJSON();
      starts.push(body);
      const consumed = preparation({
        version: state.version,
        mode: state.executionMode,
        alias: state.groupSessionSetup.requestedJoinAlias,
        status: "consumed",
      });
      state = consumed;
      return fulfill({
        session: { _id: "host-session" },
        current: runtimeProjection(consumed.executionMode),
        preparation: consumed,
        alreadyStarted: false,
        ...(consumed.executionMode === "synchronized"
          ? { synchronized: synchronizedProjection(consumed.groupSessionSetup.requestedJoinAlias) }
          : {}),
      });
    }
    if (path === "/api/v2/synchronized-visit-sessions/sync-1" && method === "GET") {
      return fulfill(synchronizedProjection(state.groupSessionSetup.requestedJoinAlias || "Aquila verde"));
    }
    if (path === "/api/v2/visit-sessions/host-session/current" && method === "GET") {
      return fulfill(runtimeProjection(state.executionMode));
    }

    return fulfill({ message: `Mock mancante per ${method} ${path}` }, 404);
  });

  return { patches, starts };
}

test("Navigator mantiene Personale come default e avvia una sessione personale", async ({ page }) => {
  const calls = await installNavigatorMocks(page);
  await page.goto(`${BASE_URL}/navigator/museums/${VENUE_ID}/visits/${VISIT_ID}`);

  const personal = page.getByRole("button", { name: /Personale/ });
  await expect(personal).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Inizia visita →" })).toBeVisible();

  await page.getByRole("button", { name: "Inizia visita →" }).click();
  await expect(page).toHaveURL(new RegExp(`/navigator/museums/${VENUE_ID}/sessions/host-session$`));
  expect(calls.starts).toEqual([{ expectedVersion: 1 }]);
});

test("Navigator passa alla modalità Di gruppo, salva l'alias e crea la lobby", async ({ page }) => {
  const calls = await installNavigatorMocks(page);
  await page.goto(`${BASE_URL}/navigator/museums/${VENUE_ID}/visits/${VISIT_ID}`);

  const groupMode = page.getByRole("button", { name: /Di gruppo/ });
  await groupMode.click();
  await expect(groupMode).toHaveAttribute("aria-pressed", "true");
  expect(calls.patches[0]).toMatchObject({ expectedVersion: 1, executionMode: "synchronized" });

  const alias = page.getByLabel("Nome per entrare");
  await expect(alias).toHaveValue("Fenice rossa");
  await alias.fill("Aquila verde");
  await alias.press("Tab");
  await expect.poll(() => calls.patches.length).toBe(2);
  expect(calls.patches[1]).toMatchObject({
    expectedVersion: 2,
    groupSessionSetup: { requestedJoinAlias: "Aquila verde" },
  });

  await page.getByRole("button", { name: "Crea la lobby →" }).click();
  await expect(page).toHaveURL(/\/navigator\/together\/sync-1$/);
  expect(calls.starts).toEqual([{ expectedVersion: 3 }]);
  await expect(page.getByLabel("Alias della visita")).toHaveText("Aquila verde");
});
