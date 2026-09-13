import { marketplaceRepository } from "../infrastructure/http/marketplace-repository.js";
import { openActionDialog } from "./feedback-primitives.js";
import { icon } from "./icons.js";

const REMOVAL_COPY = Object.freeze({
  item_edition: {
    subject: "contenuto",
    consequence: "Il contenuto e tutte le sue versioni editoriali non compariranno più nella tua Libreria.",
    removedKey: "content",
  },
  editorial_context: {
    subject: "raccolta editoriale",
    consequence: "La raccolta non comparirà più nella tua Libreria e non potrà essere usata per nuove visite o nuove pubblicazioni.",
    removedKey: "collection",
  },
  namespace: {
    subject: "regole editoriali",
    consequence: "Le regole editoriali non compariranno più nella tua Libreria e non saranno disponibili per nuovi contenuti.",
    removedKey: "namespace",
  },
  physical_vocabulary: {
    subject: "vocabolario fisico",
    consequence: "Il vocabolario fisico non comparirà più nella tua Libreria e non potrà essere scelto per nuovo authoring di sedi. Le revisioni già pinzate restano snapshot storiche utilizzabili.",
    removedKey: "physical_vocabulary",
  },
  visit: {
    subject: "visita",
    consequence: "La visita e tutte le sue versioni non compariranno più nella tua Libreria e non potranno essere pubblicate nuovamente.",
    removedKey: "visit",
  },
});

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function ownedResourceRemovalCopy(resourceType) {
  return REMOVAL_COPY[resourceType] || null;
}

export function hasOwnedResourceRemovalOperation(availableOperations = [], operationCodes = ["remove_resource"]) {
  const accepted = new Set(Array.isArray(operationCodes) ? operationCodes : [operationCodes]);
  return (availableOperations || []).some((operation) => accepted.has(operation.code));
}

export function renderOwnedResourceRemoval({
  resourceType,
  availableOperations = [],
  operationCodes = ["remove_resource"],
  ownership = "owned",
} = {}) {
  const copy = ownership === "owned" && hasOwnedResourceRemovalOperation(availableOperations, operationCodes)
    ? ownedResourceRemovalCopy(resourceType)
    : null;
  if (!copy) return "";
  return `<section class="panel resource-danger-zone"><span class="eyebrow">Operazione sensibile</span><h2>Elimina dall’account</h2><p>${escapeHtml(copy.consequence)}</p><p class="note">Chi ha già acquisito la risorsa continuerà a usare la snapshot autorizzata. Lo storico commerciale non verrà cancellato.</p><button class="danger" type="button" data-owned-resource-removal>${icon("trash", { size: 15 })} Elimina ${escapeHtml(copy.subject)}</button></section>`;
}

export async function requestOwnedResourceRemoval({
  principal,
  resourceType,
  resourceId,
  title,
  removalImpact = null,
  unsavedChanges = false,
  onConfirmed = null,
} = {}) {
  const copy = ownedResourceRemovalCopy(resourceType);
  if (!copy || !principal?.principalType || !principal?.principalId || !resourceId) {
    throw new TypeError("requestOwnedResourceRemoval richiede principal e riferimento a una risorsa eliminabile.");
  }
  const relationCount = resourceType === "editorial_context"
    ? Number(removalImpact?.semanticGraphRelationCount || 0)
    : 0;
  const graphImpact = resourceType === "editorial_context"
    ? ` Anche il grafo locale verrà ritirato${relationCount ? ` con ${relationCount} ${relationCount === 1 ? "relazione" : "relazioni"} nella revisione corrente` : ""}; le revisioni immutabili e le release già pubblicate restano conservate.`
    : "";
  const dirtyImpact = unsavedChanges
    ? " Le modifiche non ancora salvate nell’editor verranno scartate."
    : "";
  const confirmed = await openActionDialog({
    title: `Eliminare ${copy.subject} “${String(title || "senza titolo")}”?`,
    message: `${copy.consequence}${dirtyImpact}${graphImpact} Le pubblicazioni verranno ritirate e le offerte rese inattive. Acquisizioni e diritti già concessi restano validi.`,
    confirmLabel: `Elimina ${copy.subject}`,
    cancelLabel: "Annulla",
    tone: "danger",
  });
  if (!confirmed) return null;
  onConfirmed?.();
  const result = await marketplaceRepository.removeWorkspaceResource(principal, { resourceType, resourceId });
  return { result, removedKey: copy.removedKey };
}
