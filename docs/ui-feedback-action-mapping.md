# ArtAround feedback action mapping audit

This document is the concrete counterpart of `ui-feedback-architecture.md`.
It maps current ArtAround user actions and states to the feedback surface and tone they require.

The audit rule is strict: **the source property or DOM role never decides the mapping**. The concrete action, whether the information remains relevant, and whether the user still has to act decide the surface.

## Visibility invariant

Global feedback has a stronger visibility contract than ordinary application UI:

- **Toast / Notification** is rendered at the document root (`body` / Vue `Teleport`) and uses `--artaround-layer-toast: 2147483400`.
- **Action Dialog** is rendered at the document root and uses `--artaround-layer-dialog: 2147483200`.
- Application drawers, sheets, map controls, sticky editors and ordinary modals must remain below those layers.
- Toasts intentionally sit above the global Action Dialog as well: an event produced while a dialog is open must remain readable and dismissible.
- Safe-area insets are respected so global feedback is not hidden behind device cut-outs.

Inline surfaces are intentionally different. Callouts, issue panels, field feedback, status indicators, empty states and progress states belong to the content they describe. They must remain in that context rather than floating above unrelated screens.

## Marketplace

| Concrete action/state | Surface | Tone | Persistence / note |
|---|---|---|---|
| Namespace metadata saved | Toast | success | 3 s |
| Namespace definitions saved | Toast | success | 3 s |
| Namespace working draft created | Toast | info | 3 s; state itself remains visible in status indicator |
| Namespace final check, no issues | Toast | success | 3 s |
| Namespace final check, issues found | Toast + Issue Panel | warning | toast announces completion; panel remains authoritative |
| Namespace has unsaved changes before final check | Inline Callout | warning | remains until saved/cancelled |
| Namespace leave with unsaved changes | Action Dialog | danger | blocks navigation until explicit decision |
| Namespace revision/source/version/dirty state | Status Indicator | neutral/success/warning | state, never a toast |
| Namespace has no definitions | Empty State | neutral | state, not an error |
| Namespace loading/saving | Progress / Busy State | info | until request completes |
| Physical Vocabulary metadata saved | Toast | success | 3 s |
| Physical definition collection saved | Toast | success | 3 s |
| Physical mappings saved | Toast | success | 3 s |
| Physical working draft created | Toast | info | 3 s |
| Physical consistency check, no issues | Toast | success | 3 s |
| Physical consistency check, issues | Toast + Issue Panel | warning | persistent issue list remains visible |
| Physical destructive confirmation | Action Dialog | danger | explicit decision required |
| Physical integrity issues | Issue Panel | warning | persistent until definitions change |
| Physical state/version/dirty flag | Status Indicator | neutral/success/warning | persistent state |
| Physical empty definition collection | Empty State | neutral | persistent until first definition |
| Physical loading/saving | Progress / Busy State | info | request lifecycle |
| Venue metadata / pre-visit / inventory / place / connection update succeeds | Toast | success | post-action event |
| Venue working release created | Toast | info | post-action event; release state remains elsewhere |
| Venue subject already exists in inventory | Toast | info | informational event after selection |
| Venue floor/place/connection/slot/target removal requires confirmation | Action Dialog | danger | destructive action |
| Venue removal completes and route changes | Toast | success | emitted by router after navigation |
| Venue consistency/workflow check completes with issues | Toast + Issue Panel | warning | issue list persists |
| Venue search failure or editor load failure | Inline Callout | danger | relevant until retry/context change |
| Workspace Home / Create Hub / Context Hub / Catalog / Venue Target Chooser persistent load or action failure | Inline Callout | danger | limited to individually audited roots; persists while failure matters |
| Visit draft created / metadata/settings/logistics saved | Toast | success | post-action event |
| Visit content added/removed/reordered | Toast | success | post-action event |
| Visit content detached from a stop and remains contextual | Toast | info | describes resulting placement mode |
| Visit occurrence is ambiguous and user must choose a physical occurrence | **Inline contextual selection feedback** | warning/info | **must not be converted to toast**; `pendingOccurrence` is still actionable |
| Visit workflow check, no issues | Toast | success | 3 s |
| Visit workflow check, issues | Toast + Issue Panel | warning | persistent issues remain |
| Visit editor/search/load failure | Inline Callout | danger | persistent while failure matters |
| Item draft restored | Toast | info | post-refresh event |
| Item subject selected / existing identity reused | Toast | info | transition event |
| Item connection added/removed | Toast | success | post-action event |
| Item draft/content saved | Toast | success | post-action event |
| Item final check with issues | Toast + Issue Panel | warning | issue panel remains authoritative |
| Item prerequisite missing | Inline Callout | warning | actionable blocker |
| Item media suggestion/upload state | Inline contextual feedback / Progress | info/warning | `mediaNotice` is intentionally not a generic toast channel |
| Item field validation | Field Feedback | danger | stays next to invalid input |
| Semantic picker search results/provider state | Inline contextual feedback | info/warning/danger | results remain relevant; never infer toast from `role=status` |

### Marketplace legacy bridge exceptions

The migration bridge has explicit per-view resolvers. In particular:

- `ArtAroundVisitAuthoringView.message` is consumed as a toast only when no occurrence choice remains pending.
- `ItemAuthoringView.notice` is mapped by concrete message family rather than treated as universally successful.
- `mediaNotice` and Semantic Entity Picker notices are excluded from the bridge.
- error and busy properties are excluded from the transient bridge.
- persistent error projection is restricted to the explicitly audited Marketplace roots; a `role="alert"` outside those roots is not converted generically.

## Navigator

The Navigator uses the same surface/tone model but renders it with Vue components. The notification protocol is intentionally identical to Marketplace (`artaround:notification`, `artaround:notification:dismiss`, 3000 ms default).

| Concrete action/state | Surface | Tone | Persistence / note |
|---|---|---|---|
| Login / registration request fails | Inline Callout | danger | form-level error; already migrated to `FeedbackCallout` |
| Login/register request is running | Progress / Busy State | info | represented by disabled submit + busy label |
| Generator initial options load | Progress / Busy State | info | until options load |
| Generator cannot load options | Inline Callout | danger | page cannot proceed |
| Generator precondition missing (venue/source/transfer time) | Field Feedback or nearest Inline Callout | danger | tied to the invalid choice; not a toast |
| Generator subject search is running | Progress / Busy State | info | until search returns |
| Generator subject-search provider warnings | Inline Callout / Issue Panel | warning | warnings remain relevant with results |
| Generator generation request fails | Inline Callout | danger | user must change/retry generation inputs |
| Generated-plan load/preparation | Progress / Busy State | info | direct `AsyncBoundary` migration |
| Generated-plan action fails | Inline Callout | danger | direct shared surface; not adapter-owned |
| Generated-plan readiness warnings/blockers | Issue Panel | warning/danger | direct shared surface |
| Library initial load | Progress / Busy State → content | info | direct `AsyncBoundary`; failure is a persistent danger Callout |
| Library has no owned visits | Empty State | neutral | legitimate absence, with generate-visit action |
| Library resumable-session removal decision | Action Dialog | danger | explicit decision required; direct shared component |
| Library resumable-session removal succeeds | Toast | success | transient completion event |
| Library resumable-session removal fails | Inline Callout | danger | remains visible until retry/context change |
| Library resumable-session options menu | ActionMenu popover, **not feedback** | neutral | interaction layer below Action Dialog/Toast |
| Visit preparation load | Progress / Busy State | info | until preparation exists |
| Visit preparation load fails | Inline Callout | danger | blocking page failure |
| Visit preparation update fails | Inline Callout | danger | remains next to preparation summary |
| Visit preparation readiness warnings | Issue Panel | warning | persistent list from backend |
| Visit preparation readiness blockers | Issue Panel | danger | blocks start; persistent |
| Visit start request is running | Progress / Busy State | info | until navigation to session |
| Visit start fails | Inline Callout | danger | retry/change configuration required |
| Session initial load fails | Inline Callout | danger | session cannot be used until recovered |
| Session action succeeds with navigation request | Toast | info | `Percorso verso …`; route itself persists on map |
| Session obstacle check returns a warning | Inline Callout | warning | route/context remains relevant; not merely an event |
| Session completes | Toast + Status/Completion state | success | toast announces event; completion screen persists |
| Browser TTS unsupported | Inline Callout/capability note | warning | capability remains unavailable |
| Voice listening cancelled | Toast | info | completed transient event |
| Voice recognition unsupported | Inline Callout | warning | capability remains unavailable |
| Voice command not recognized / unavailable | Toast | warning | transient attempt result |
| Voice command recognized | Toast | info | transient acknowledgement before action result |
| Finish-session request | Action Dialog | danger | explicit confirmation required |
| Session action sheet | Domain drawer/sheet, **not feedback** | neutral | teleported to body on drawer layer; remains below Action Dialog/Toast |
| Session media lightbox | Domain dialog, **not feedback** | neutral | content viewer; must stay below feedback layers |
| Map asset unavailable | Inline Callout | info/warning | remains relevant while viewing that floor |
| Map venue warnings | Issue Panel | warning | persistent while map context is active |
| Current session/route/progress | Status Indicator / Progress | neutral/info | state, never toast |

## Completeness checks

The implementation contract tests must verify all of the following:

1. Both clients expose all approved tones.
2. Marketplace exposes every approved feedback surface as a Web Component.
3. Navigator exposes corresponding Vue components.
4. Both notification hosts use a 3000 ms default and independent timers.
5. Both stacks use FIFO visual order.
6. Both global hosts escape local stacking contexts (`body` / `Teleport`).
7. `--artaround-layer-toast` is greater than `--artaround-layer-dialog`, and both are far above ordinary application layers.
8. Application popover/drawer/modal layers remain below Action Dialog and Toast.
9. The Marketplace Visit occurrence-selection branch is explicitly excluded from transient toast conversion.
10. Search/provider feedback, field validation, busy states and persistent errors are not migrated by generic DOM-role matching.
11. Directly migrated Navigator views (currently GeneratedPlan and Library among the audited set) are removed from overlapping legacy adapter selectors.
12. The mapping tables above are updated whenever a new feedback-producing action family is introduced.
