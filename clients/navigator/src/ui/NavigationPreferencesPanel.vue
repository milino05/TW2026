<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import ChoiceCard from "./ChoiceCard.vue";
import type {
  ExecutionMode,
  ExecutionPreparationProjection,
  PersonalNavigationNeedDefinition,
  PreparationUpdate,
  RoutingRequirement,
  VenueNavigationControl,
} from "../infrastructure/http/executionPreparationRepository";

type NavigationProjection = ExecutionPreparationProjection["navigation"];
type PersonalPriority = "preferred" | "required";

type NeedState = {
  enabled: boolean;
  priority: PersonalPriority;
  value: unknown;
};

type VenueControlState = {
  enabled: boolean;
  value: unknown;
};

const props = withDefaults(defineProps<{
  navigation: NavigationProjection;
  executionMode: ExecutionMode;
  disabled?: boolean;
}>(), { disabled: false });

const emit = defineEmits<{ apply: [patch: PreparationUpdate] }>();

const movementPacePreference = ref(.5);
const needStates = reactive<Record<string, NeedState>>({});
const selectedProfiles = reactive<Record<string, string>>({});
const venueControlStates = reactive<Record<string, VenueControlState>>({});
const validationError = ref<string | null>(null);

function controlKey(venueId: string, definitionId: string) {
  return `${venueId}::${definitionId}`;
}

function defaultControlValue(control: VenueNavigationControl) {
  if (control.valueMode === "fixed") return control.value;
  if (control.dataType === "boolean") return true;
  if (control.dataType === "choice") return control.options[0]?.value ?? "";
  return "";
}

function syncFromProjection() {
  movementPacePreference.value = props.navigation.movementPacePreference ?? .5;
  validationError.value = null;

  const selectedNeedById = new Map(props.navigation.personalNeeds.selected.map((entry) => [entry.id, entry]));
  Object.keys(needStates).forEach((key) => delete needStates[key]);
  props.navigation.personalNeeds.catalog.forEach((need) => {
    const selected = selectedNeedById.get(need.id);
    needStates[need.id] = {
      enabled: Boolean(selected),
      priority: selected?.priority || need.defaultPriority || "preferred",
      value: selected?.value ?? need.value ?? "",
    };
  });

  Object.keys(selectedProfiles).forEach((key) => delete selectedProfiles[key]);
  props.navigation.venues.forEach((venue) => {
    selectedProfiles[String(venue.venueId)] = venue.selectedProfileDefinitionId || "";
  });

  const selectedControls = new Map(props.navigation.venueControlSelections.map((entry) => [
    controlKey(String(entry.venueId), entry.physicalAttributeDefinitionId),
    entry,
  ]));
  Object.keys(venueControlStates).forEach((key) => delete venueControlStates[key]);
  props.navigation.venues.forEach((venue) => {
    venue.controls.forEach((control) => {
      const key = controlKey(String(venue.venueId), control.definitionId);
      const selected = selectedControls.get(key);
      venueControlStates[key] = {
        enabled: Boolean(selected),
        value: selected?.value ?? defaultControlValue(control),
      };
    });
  });
}

watch(() => props.navigation, syncFromProjection, { deep: true, immediate: true });

const movementPaceLabel = computed(() => {
  if (movementPacePreference.value < .34) return "Rilassato";
  if (movementPacePreference.value < .67) return "Regolare";
  return "Sostenuto";
});

const commonNeeds = computed(() => props.navigation.personalNeeds.catalog.filter((entry) => !entry.advanced));
const advancedNeeds = computed(() => props.navigation.personalNeeds.catalog.filter((entry) => entry.advanced));

function needSupport(needId: string) {
  const venues = props.navigation.personalNeeds.supportByVenue;
  if (!venues.length) return { tone: "neutral", label: "Verrà verificata quando sarà disponibile la mappa fisica." };
  const unsupported = venues.filter((venue) => venue.needs.find((entry) => entry.id === needId)?.supported !== true);
  if (!unsupported.length) return { tone: "ok", label: venues.length === 1 ? "Supportata dalla sede" : "Supportata in tutte le sedi" };
  return {
    tone: "warning",
    label: unsupported.length === venues.length
      ? "La visita non dispone di informazioni sufficienti per questa esigenza"
      : `Informazione non disponibile: ${unsupported.map((venue) => venue.name).join(", ")}`,
  };
}

function missingValue(value: unknown) {
  return value === null || value === undefined || (typeof value === "string" && value.trim() === "");
}

function needRequirement(need: PersonalNavigationNeedDefinition): RoutingRequirement | null {
  const state = needStates[need.id];
  if (!state?.enabled) return null;
  let value = need.value;
  if (need.valueMode === "user") {
    if (need.dataType === "number") {
      if (missingValue(state.value)) throw new Error(`Inserisci un valore per “${need.label}”.`);
      const parsed = Number(state.value);
      if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`Inserisci un valore valido per “${need.label}”.`);
      value = parsed;
    } else value = state.value;
  }
  return {
    physicalFeatureRef: need.physicalFeatureRef,
    operator: need.operator,
    value,
    priority: state.priority,
    weight: 1,
  };
}

function setProfile(venueId: string, definitionId: string) {
  selectedProfiles[String(venueId)] = definitionId;
}

function toggleControl(venueId: string, control: VenueNavigationControl) {
  const state = venueControlStates[controlKey(String(venueId), control.definitionId)];
  if (state) state.enabled = !state.enabled;
}

function buildPatch(): PreparationUpdate {
  const navigationRequirements = props.navigation.personalNeeds.catalog
    .map(needRequirement)
    .filter((entry): entry is RoutingRequirement => entry !== null);

  const routingProfileSelections = props.navigation.venues.flatMap((venue) => {
    const routingProfileDefinitionId = selectedProfiles[String(venue.venueId)] || "";
    return routingProfileDefinitionId ? [{ venueId: String(venue.venueId), routingProfileDefinitionId }] : [];
  });

  const venueControlSelections = props.navigation.venues.flatMap((venue) => venue.controls.flatMap((control) => {
    const state = venueControlStates[controlKey(String(venue.venueId), control.definitionId)];
    if (!state?.enabled) return [];
    if (control.valueMode === "fixed") {
      return [{ venueId: String(venue.venueId), physicalAttributeDefinitionId: control.definitionId }];
    }
    let value: unknown = state.value;
    if (control.dataType === "number") {
      if (missingValue(value)) throw new Error(`Inserisci un valore per “${control.label}”.`);
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) throw new Error(`Inserisci un valore valido per “${control.label}”.`);
      value = parsed;
    }
    if (control.dataType === "choice" && (value === "" || value == null)) throw new Error(`Scegli un valore per “${control.label}”.`);
    if (control.dataType === "boolean") value = Boolean(value);
    return [{ venueId: String(venue.venueId), physicalAttributeDefinitionId: control.definitionId, value }];
  }));

  return {
    movementPacePreference: movementPacePreference.value,
    navigationRequirements,
    routingProfileSelections,
    venueControlSelections,
  };
}

function apply() {
  validationError.value = null;
  try { emit("apply", buildPatch()); }
  catch (cause) { validationError.value = cause instanceof Error ? cause.message : "Controlla le opzioni di percorso."; }
}

function profileRequirementSummary(profile: NavigationProjection["venues"][number]["profiles"][number]) {
  if (!profile.requirements.length) return "Usa il routing standard della sede.";
  return profile.requirements.slice(0, 3).map((entry) => entry.label).join(" · ");
}
</script>

<template>
  <section class="navigation-panel" aria-labelledby="navigation-panel-title">
    <div class="navigation-panel__intro">
      <p class="eyebrow">Il tuo percorso</p>
      <h3 id="navigation-panel-title">Esigenze e opzioni di percorso</h3>
      <p>Le esigenze personali vengono dal tuo profilo. Le opzioni della sede valgono soltanto per questa visita.</p>
    </div>

    <div v-if="executionMode === 'synchronized'" class="group-route-note" role="note">
      <strong>Percorso del gruppo</strong>
      <p>Sei l’host: queste impostazioni determineranno il percorso condiviso. Le preferenze di movimento dei partecipanti non lo modificano.</p>
    </div>

    <section class="navigation-block" aria-labelledby="personal-needs-title">
      <div class="navigation-block__heading">
        <div>
          <strong id="personal-needs-title">Le tue esigenze</strong>
          <small>Partono dai tuoi default, ma le modifiche qui valgono solo per questa visita.</small>
        </div>
      </div>

      <div v-if="commonNeeds.length" class="personal-needs-list">
        <article
          v-for="need in commonNeeds"
          :key="need.id"
          class="personal-need"
          :class="{ active: needStates[need.id]?.enabled }"
        >
          <label class="personal-need__main">
            <input v-model="needStates[need.id].enabled" type="checkbox" :disabled="disabled">
            <span class="personal-need__indicator" aria-hidden="true">{{ needStates[need.id]?.enabled ? "✓" : "+" }}</span>
            <span class="personal-need__copy">
              <strong>{{ need.label }}</strong>
              <small>{{ need.description }}</small>
            </span>
          </label>
          <div v-if="needStates[need.id]?.enabled" class="personal-need__settings">
            <fieldset>
              <legend>Quanto è importante?</legend>
              <label><input v-model="needStates[need.id].priority" type="radio" :name="`priority-${need.id}`" value="preferred" :disabled="disabled"> Preferisco</label>
              <label><input v-model="needStates[need.id].priority" type="radio" :name="`priority-${need.id}`" value="required" :disabled="disabled"> Necessario</label>
            </fieldset>
            <p class="support-note" :class="`support-note--${needSupport(need.id).tone}`">{{ needSupport(need.id).label }}</p>
          </div>
        </article>
      </div>
      <p v-else class="navigation-empty">Non hai esigenze globali configurabili per questa visita.</p>

      <details v-if="advancedNeeds.length" class="advanced-needs">
        <summary>Esigenze avanzate</summary>
        <p>Imposta una soglia fisica precisa soltanto se ti serve.</p>
        <div class="personal-needs-list">
          <article
            v-for="need in advancedNeeds"
            :key="need.id"
            class="personal-need"
            :class="{ active: needStates[need.id]?.enabled }"
          >
            <label class="personal-need__main">
              <input v-model="needStates[need.id].enabled" type="checkbox" :disabled="disabled">
              <span class="personal-need__indicator" aria-hidden="true">{{ needStates[need.id]?.enabled ? "✓" : "+" }}</span>
              <span class="personal-need__copy"><strong>{{ need.label }}</strong><small>{{ need.description }}</small></span>
            </label>
            <div v-if="needStates[need.id]?.enabled" class="personal-need__settings">
              <label class="numeric-control">
                <span>{{ need.label }}</span>
                <span class="numeric-control__field"><input v-model="needStates[need.id].value" type="number" min="0" step="any" :disabled="disabled"><em>{{ need.unit }}</em></span>
              </label>
              <fieldset>
                <legend>Quanto è importante?</legend>
                <label><input v-model="needStates[need.id].priority" type="radio" :name="`priority-${need.id}`" value="preferred" :disabled="disabled"> Preferisco</label>
                <label><input v-model="needStates[need.id].priority" type="radio" :name="`priority-${need.id}`" value="required" :disabled="disabled"> Necessario</label>
              </fieldset>
              <p class="support-note" :class="`support-note--${needSupport(need.id).tone}`">{{ needSupport(need.id).label }}</p>
            </div>
          </article>
        </div>
      </details>
    </section>

    <section
      v-for="venue in navigation.venues"
      :key="venue.venueId"
      class="navigation-block venue-options"
      :aria-labelledby="`venue-options-${venue.venueId}`"
    >
      <div class="navigation-block__heading">
        <div>
          <strong :id="`venue-options-${venue.venueId}`">Opzioni di {{ venue.name }}</strong>
          <small>Queste scelte sono definite dalla sede e non vengono salvate nel tuo profilo.</small>
        </div>
      </div>

      <div v-if="venue.profiles.length" class="profile-choices">
        <ChoiceCard
          :selected="!selectedProfiles[String(venue.venueId)]"
          :disabled="disabled"
          title="Percorso standard"
          description="Usa il percorso più rapido compatibile con le tue esigenze."
          @activate="setProfile(String(venue.venueId), '')"
        />
        <ChoiceCard
          v-for="profile in venue.profiles"
          :key="profile.definitionId"
          :selected="selectedProfiles[String(venue.venueId)] === profile.definitionId"
          :disabled="disabled"
          :title="profile.label"
          :description="profile.description"
          @activate="setProfile(String(venue.venueId), profile.definitionId)"
        >
          <template #details>{{ profileRequirementSummary(profile) }}</template>
        </ChoiceCard>
      </div>

      <div v-if="venue.controls.length" class="venue-controls">
        <p class="venue-controls__label">Altre preferenze</p>
        <template v-for="control in venue.controls" :key="control.definitionId">
          <ChoiceCard
            v-if="control.valueMode === 'fixed'"
            :selected="venueControlStates[controlKey(String(venue.venueId), control.definitionId)]?.enabled || false"
            :disabled="disabled"
            :title="control.label"
            :description="control.description"
            indicator="check"
            @activate="toggleControl(String(venue.venueId), control)"
          />
          <article v-else class="venue-control-input" :class="{ active: venueControlStates[controlKey(String(venue.venueId), control.definitionId)]?.enabled }">
            <label class="venue-control-input__toggle">
              <input v-model="venueControlStates[controlKey(String(venue.venueId), control.definitionId)].enabled" type="checkbox" :disabled="disabled">
              <span><strong>{{ control.label }}</strong><small>{{ control.description }}</small></span>
            </label>
            <div v-if="venueControlStates[controlKey(String(venue.venueId), control.definitionId)]?.enabled" class="venue-control-input__value">
              <label v-if="control.dataType === 'number'">
                <span>Valore</span>
                <span class="numeric-control__field"><input v-model="venueControlStates[controlKey(String(venue.venueId), control.definitionId)].value" type="number" step="any" :disabled="disabled"><em>{{ control.unit }}</em></span>
              </label>
              <label v-else-if="control.dataType === 'choice'">
                <span>Scelta</span>
                <select v-model="venueControlStates[controlKey(String(venue.venueId), control.definitionId)].value" :disabled="disabled">
                  <option v-for="option in control.options" :key="option.value" :value="option.value">{{ option.label }}</option>
                </select>
              </label>
              <fieldset v-else>
                <legend>Scelta</legend>
                <label><input v-model="venueControlStates[controlKey(String(venue.venueId), control.definitionId)].value" type="radio" :name="`venue-${venue.venueId}-${control.definitionId}`" :value="true" :disabled="disabled"> Sì</label>
                <label><input v-model="venueControlStates[controlKey(String(venue.venueId), control.definitionId)].value" type="radio" :name="`venue-${venue.venueId}-${control.definitionId}`" :value="false" :disabled="disabled"> No</label>
              </fieldset>
            </div>
          </article>
        </template>
      </div>
    </section>

    <section class="navigation-block pace-block" aria-labelledby="pace-title">
      <div class="pace-heading"><strong id="pace-title">Ritmo di spostamento</strong><output>{{ movementPaceLabel }}</output></div>
      <input v-model.number="movementPacePreference" type="range" min="0" max="1" step="0.1" :disabled="disabled">
      <div class="pace-labels"><small>Rilassato</small><small>Sostenuto</small></div>
    </section>

    <p v-if="validationError" class="navigation-error" role="alert">{{ validationError }}</p>
    <button class="navigation-apply" type="button" :disabled="disabled" @click="apply">
      {{ disabled ? "Aggiornamento…" : "Aggiorna percorso" }}
    </button>
  </section>
</template>

<style scoped>
.navigation-panel { display: grid; gap: 1rem; }
.navigation-panel__intro h3 { margin: .18rem 0 .3rem; font-size: 1.15rem; }
.navigation-panel__intro p:last-child { margin: 0; color: #617168; line-height: 1.45; }
.group-route-note { padding: .9rem; border: 1px solid rgba(96, 122, 68, .25); border-radius: 1rem; background: #f5f7e9; }
.group-route-note strong { display: block; }
.group-route-note p { margin: .3rem 0 0; color: #5e6955; font-size: .82rem; line-height: 1.45; }
.navigation-block { display: grid; gap: .75rem; padding: .9rem; border: 1px solid rgba(38, 67, 55, .14); border-radius: 1rem; background: rgba(255,255,255,.68); }
.navigation-block__heading strong { display: block; }
.navigation-block__heading small { display: block; margin-top: .22rem; color: #68766e; line-height: 1.4; }
.personal-needs-list,.profile-choices,.venue-controls { display: grid; gap: .65rem; }
.personal-need { display: grid; gap: .7rem; padding: .8rem; border: 1px solid rgba(38, 67, 55, .14); border-radius: .9rem; background: rgba(255,255,255,.88); }
.personal-need.active { border-color: rgba(38, 101, 74, .48); box-shadow: 0 0 0 2px rgba(85,139,115,.1); }
.personal-need__main { display: grid; grid-template-columns: auto 2rem minmax(0,1fr); gap: .55rem; align-items: start; cursor: pointer; }
.personal-need__main>input { margin-top: .45rem; }
.personal-need__indicator { display: grid; place-items: center; width: 2rem; height: 2rem; border-radius: .65rem; background: rgba(46,84,66,.09); color: #285b45; font-weight: 900; }
.active .personal-need__indicator { background: #285b45; color: #fff; }
.personal-need__copy { display: grid; gap: .2rem; }
.personal-need__copy small { color: #68766e; font-size: .78rem; line-height: 1.4; }
.personal-need__settings { display: grid; gap: .65rem; padding-top: .65rem; border-top: 1px solid rgba(38,67,55,.11); }
.personal-need__settings fieldset,.venue-control-input__value fieldset { display: flex; flex-wrap: wrap; gap: .4rem; margin: 0; padding: 0; border: 0; }
.personal-need__settings legend,.venue-control-input__value legend { width: 100%; margin-bottom: .2rem; color: #68766e; font-size: .72rem; }
.personal-need__settings fieldset label,.venue-control-input__value fieldset label { display: inline-flex; align-items: center; gap: .3rem; min-height: 2.1rem; padding: .32rem .5rem; border: 1px solid rgba(38,67,55,.14); border-radius: 999px; background: rgba(242,247,244,.8); font-size: .78rem; }
.support-note { margin: 0; padding: .5rem .6rem; border-radius: .65rem; font-size: .74rem; line-height: 1.35; }
.support-note--ok { background: #edf7f0; color: #315d43; }
.support-note--warning { background: #fff5df; color: #73541b; }
.support-note--neutral { background: #f1f4f2; color: #5c6962; }
.advanced-needs { border-top: 1px solid rgba(38,67,55,.11); padding-top: .7rem; }
.advanced-needs summary { cursor: pointer; font-weight: 800; }
.advanced-needs>p { margin: .4rem 0 .7rem; color: #68766e; font-size: .78rem; }
.numeric-control { display: grid; gap: .35rem; color: #5b6a62; font-size: .75rem; font-weight: 700; }
.numeric-control__field { display: grid; grid-template-columns: minmax(0,1fr) auto; align-items: center; overflow: hidden; border: 1px solid rgba(38,67,55,.16); border-radius: .72rem; background: #fff; }
.numeric-control__field input { min-width: 0; border: 0; padding: .7rem; background: transparent; }
.numeric-control__field em { padding: 0 .7rem; color: #65736b; font-style: normal; font-weight: 800; }
.venue-options { background: rgba(247,249,247,.86); }
.venue-controls { padding-top: .2rem; }
.venue-controls__label { margin: .1rem 0 0; color: #65736b; font-size: .76rem; font-weight: 800; text-transform: uppercase; letter-spacing: .04em; }
.venue-control-input { display: grid; gap: .7rem; padding: .85rem; border: 1px solid rgba(38,67,55,.14); border-radius: .9rem; background: #fff; }
.venue-control-input.active { border-color: rgba(38,101,74,.45); }
.venue-control-input__toggle { display: flex; align-items: flex-start; gap: .6rem; cursor: pointer; }
.venue-control-input__toggle input { margin-top: .25rem; }
.venue-control-input__toggle span { display: grid; gap: .18rem; }
.venue-control-input__toggle small { color: #68766e; line-height: 1.4; }
.venue-control-input__value { padding-top: .65rem; border-top: 1px solid rgba(38,67,55,.11); }
.venue-control-input__value>label { display: grid; gap: .35rem; color: #5b6a62; font-size: .75rem; font-weight: 700; }
.venue-control-input select { width: 100%; min-height: 2.8rem; border: 1px solid rgba(38,67,55,.16); border-radius: .72rem; padding: .65rem; background: #fff; }
.pace-block { gap: .55rem; }
.pace-heading,.pace-labels { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
.pace-heading output { border-radius: 999px; padding: .22rem .5rem; background: rgba(46,84,66,.09); color: #315d48; font-size: .74rem; font-weight: 800; }
.pace-labels { color: #68766e; }
.navigation-error { margin: 0; padding: .7rem .8rem; border-radius: .8rem; background: #fff0ed; color: #842e24; font-size: .8rem; }
.navigation-apply { width: 100%; min-height: 3rem; }
.navigation-empty { margin: 0; color: #68766e; font-size: .8rem; }
@media (min-width: 48rem) {
  .personal-needs-list,.profile-choices { grid-template-columns: repeat(2,minmax(0,1fr)); }
  .advanced-needs .personal-needs-list { grid-template-columns: repeat(2,minmax(0,1fr)); }
}
</style>
