const blockers = new Map();
let nextBlockerId = 1;
let confirmationInFlight = null;

function blockingEntries() {
  return [...blockers.values()].filter((entry) => {
    try { return Boolean(entry.isBlocking?.()); }
    catch { return false; }
  });
}

export function hasNavigationLossRisk() {
  return blockingEntries().length > 0;
}

export function registerNavigationLossBlocker({ isBlocking, requestConfirmation, discard } = {}) {
  if (typeof isBlocking !== "function" || typeof requestConfirmation !== "function") {
    throw new TypeError("A navigation-loss blocker requires isBlocking() and requestConfirmation().");
  }
  const id = nextBlockerId++;
  blockers.set(id, { isBlocking, requestConfirmation, discard });
  return () => blockers.delete(id);
}

export function confirmNavigationLoss(context = {}) {
  if (confirmationInFlight) return confirmationInFlight;
  const entries = blockingEntries();
  if (!entries.length) return Promise.resolve(true);

  confirmationInFlight = (async () => {
    for (const entry of entries) {
      if (!entry.isBlocking?.()) continue;
      const confirmed = await entry.requestConfirmation(context);
      if (!confirmed) return false;
      entry.discard?.(context);
    }
    return true;
  })().finally(() => { confirmationInFlight = null; });

  return confirmationInFlight;
}
