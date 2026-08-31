# ArtAround UI feedback architecture

ArtAround separates **surface** (how information behaves) from **tone** (what the information means).

Do not choose a component from its color or from whether the message contains the word "errore". Choose the surface from scope, persistence and required user action; then choose a tone.

## Supported tones

- `neutral`
- `info`
- `success`
- `warning`
- `danger`

A tone never decides lifecycle by itself. A danger field error, a danger callout and a danger action dialog have different behavior.

## Global visibility invariant

Global feedback must not be obscured by ArtAround application UI.

- Toast and Action Dialog are mounted outside local page stacking contexts: Marketplace appends them to `body`; Navigator uses Vue `Teleport to="body"`.
- `--artaround-layer-dialog` is `2147483200`.
- `--artaround-layer-toast` is `2147483400` and intentionally sits above the dialog layer.
- Drawers, sticky panels, bottom sheets, maps, media overlays and ordinary domain dialogs must remain below these layers.
- Global surfaces respect safe-area insets.

This guarantee applies to **global** surfaces. Inline Callout, Issue Panel, Field Feedback, Status Indicator, Empty State and Progress State remain in the content they describe; making them globally floating would destroy their contextual meaning.

## Surfaces

### Toast / Notification

Use when **something just happened** and the user does not need to do anything to keep the information valid.

Examples: details saved, mapping saved, venue removed, connection added, draft restored.

Contract:
- rendered by one global notification host per client;
- does not participate in page layout;
- default lifetime is 3000 ms;
- every toast owns its timer;
- FIFO visual order: oldest on top, newer notifications below;
- manual dismissal is available;
- `success`, `info`, `warning` and `neutral` use polite live status semantics;
- `danger` uses assertive alert semantics;
- callers use `notify.*(...)` and never position a toast themselves.

### Inline Callout

Use when information is still relevant while the user remains in the current context and may need to act on it.

Examples: save changes before running a workflow; explain why a capability is unavailable; warn that an operation has consequences without blocking the page.

Contract:
- persistent while the condition is true;
- belongs next to the section it describes;
- does not disappear on a timer;
- does not block interaction with the rest of the page.

### Issue Panel

Use for a **structured collection of problems** produced by integrity, consistency or workflow checks.

Examples: three vocabulary integrity issues; publication blockers; several invalid references.

Contract:
- persistent until the underlying problems change;
- may contain multiple issues and links/focus targets;
- must not be replaced by a transient toast;
- a toast may announce that a check completed, while the issue panel remains the authoritative list.

### Field Feedback

Use when feedback belongs to a specific input.

Examples: required field missing; invalid numeric range; incompatible selection.

Contract:
- remains until the field becomes valid or the context changes;
- associated with the input through `aria-invalid` and `aria-describedby` where applicable;
- placed adjacent to the field;
- never use a toast as the only representation of a field error.

### Action Dialog

Use when the action initiated by the user **must pause until an explicit decision is made**.

Examples: leave without saving; remove a definition; destructive operation confirmation; choose what to do after a completed workflow.

Contract:
- modal backdrop;
- `role="dialog"` + `aria-modal="true"`;
- focus is trapped inside the dialog;
- `Escape` cancels when dismissal is allowed;
- focus returns to the invoking control;
- destructive confirmations use `tone="danger"`;
- global layer remains above ordinary application dialogs;
- Marketplace uses `openActionDialog(...)` for programmatic confirmation flows; Navigator exposes `FeedbackActionDialog.vue`.

### Status Indicator

Use to describe the current state of a resource or process, not an event.

Examples: Draft, In review, Version 3, Unsaved changes.

Contract:
- persistent while the state is true;
- compact and non-modal;
- no automatic timeout.

### Empty State

Use when a collection or workspace legitimately contains no content yet.

Examples: no definitions, no connections, no results created yet.

Contract:
- explains the empty state;
- may expose the primary action to leave it;
- is not an error by default.

### Progress / Busy State

Use while an operation is running.

Examples: loading editor, uploading an image, running a consistency check.

Contract:
- remains until the operation completes;
- must not be converted into a toast;
- may coexist with disabled controls or `aria-busy` on the affected region.

## Decision rule

1. Did something just happen?
   - No action needed -> **Toast**.
   - User must decide before the action can continue -> **Action Dialog**.
   - User can resolve it while staying in the page -> **Inline Callout**.
2. Is there a problem rather than an event?
   - One input -> **Field Feedback**.
   - Structured group of problems -> **Issue Panel**.
3. Is it describing the current state?
   - Resource/process state -> **Status Indicator**.
   - No content exists -> **Empty State**.
   - Work is still running -> **Progress / Busy State**.

## Marketplace API and elements

```js
import { notify } from "../application/ui-feedback.js";

notify.success("Dettagli salvati.");
notify.info("Bozza ripristinata.");
notify.warning("Operazione completata con avvisi.");
notify.danger("Operazione non completata.");
```

The default notification duration is 3000 ms and can be overridden when a specific transient event genuinely needs more time.

```js
import { openActionDialog } from "../ui/feedback-primitives.js";

const confirmed = await openActionDialog({
  tone: "danger",
  title: "Uscire senza salvare?",
  message: "Le modifiche non salvate andranno perse.",
  confirmLabel: "Esci senza salvare",
  cancelLabel: "Resta nell'editor",
});
```

Declarative Marketplace primitives are available as:

- `artaround-callout`
- `artaround-issue-panel`
- `artaround-field-feedback`
- `artaround-action-dialog`
- `artaround-status-indicator`
- `artaround-empty-state`
- `artaround-progress-state`
- `artaround-toast-center`

## Navigator API and components

Navigator exposes the same notification protocol and default lifetime from `src/application/uiFeedback.ts`.

Vue surfaces are:

- `FeedbackToastHost.vue`
- `FeedbackCallout.vue`
- `FeedbackIssuePanel.vue`
- `FeedbackFieldFeedback.vue`
- `FeedbackActionDialog.vue`
- `FeedbackStatusIndicator.vue`
- `FeedbackEmptyState.vue`
- `FeedbackProgressState.vue`

The toast host is mounted once in `App.vue` and teleported to `body`.

## Migration rule

Never migrate by searching for every `role="status"` or `role="alert"` and turning it into a toast. Those roles are also used by busy states, contextual search feedback, field errors and persistent blockers.

A legacy property is not a semantic contract either. A single `message`/`notice` property may contain both transient events and actionable contextual guidance. Every migration therefore needs an action-aware resolver, and that resolver may explicitly keep a message inline.

The concrete audit is maintained in `docs/ui-feedback-action-mapping.md`.
