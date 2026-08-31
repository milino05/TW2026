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

export function registerNavigationLossBlocker({ isBlocking, confirm, discard } = {}) {
  if (typeof isBlocking !== "function" || typeof confirm !== "function") {
    throw new TypeError("A navigation-loss blocker requires isBlocking() and confirm().");
  }
  const id = nextBlockerId++;
  blockers.set(id, { isBlocking, confirm, discard });
  return () => blockers.delete(id);
}

export function confirmNavigationLoss(context = {}) {
  if (confirmationInFlight) return confirmationInFlight;
  const entries = blockingEntries();
  if (!entries.length) return Promise.resolve(true);

  confirmationInFlight = (async () => {
    for (const entry of entries) {
      if (!entry.isBlocking?.()) continue;
      const confirmed = await entry.confirm(context);
      if (!confirmed) return false;
      entry.discard?.(context);
    }
    return true;
  })().finally(() => { confirmationInFlight = null; });

  return confirmationInFlight;
}
