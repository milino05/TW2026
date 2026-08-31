import { createRouter, createWebHistory } from "vue-router";
import { useAuthStore, useConfiguredVenueStore } from "./stores";
import LoginView from "../ui/LoginView.vue";
import MuseumSelectorView from "../ui/MuseumSelectorView.vue";
import LibraryView from "../ui/LibraryView.vue";
import VisitDetailView from "../ui/VisitDetailView.vue";
import GenerateView from "../ui/GenerateView.vue";
import GeneratedPlanView from "../ui/GeneratedPlanView.vue";
import SessionView from "../ui/SessionView.vue";
import PlaceholderView from "../ui/PlaceholderView.vue";
import SynchronizedJoinView from "../ui/SynchronizedJoinView.vue";
import SynchronizedSessionView from "../ui/SynchronizedSessionView.vue";

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: "/", name: "home", component: LoginView },
    { path: "/museums", name: "museums", component: MuseumSelectorView, meta: { requiresAuth: true } },
    { path: "/together", name: "together-join", component: SynchronizedJoinView, meta: { requiresAuth: true } },
    {
      path: "/together/:synchronizedSessionId",
      name: "together-session",
      component: SynchronizedSessionView,
      meta: { requiresAuth: true, immersive: true },
    },
    {
      path: "/museums/:venueId/library",
      name: "museum-library",
      component: LibraryView,
      meta: { requiresAuth: true, requiresVenue: true },
    },
    {
      path: "/museums/:venueId/visits/:visitId",
      name: "museum-visit-detail",
      component: VisitDetailView,
      meta: { requiresAuth: true, requiresVenue: true },
    },
    {
      path: "/museums/:venueId/generate",
      name: "museum-generate",
      component: GenerateView,
      meta: { requiresAuth: true, requiresVenue: true },
    },
    {
      path: "/museums/:venueId/generated-plans/:planId",
      name: "museum-generated-plan",
      component: GeneratedPlanView,
      meta: { requiresAuth: true, requiresVenue: true },
    },
    {
      path: "/museums/:venueId/sessions/:sessionId",
      name: "museum-session",
      component: SessionView,
      meta: { requiresAuth: true, requiresVenue: true, immersive: true },
    },
    { path: "/library", redirect: { name: "museums" } },
    { path: "/generate", redirect: { name: "museums" } },
    { path: "/:pathMatch(.*)*", name: "not-found", component: PlaceholderView, props: { title: "Pagina non trovata" } },
  ],
});

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  const venueStore = useConfiguredVenueStore();
  if (to.meta.requiresAuth && !auth.authenticated) return { name: "home" };
  if (to.name === "home" && auth.authenticated) return { name: "museums" };

  if (to.name === "museums") {
    venueStore.clearSelection();
    return true;
  }

  if (to.meta.requiresVenue) {
    const venueId = String(to.params.venueId || "");
    if (venueStore.selectedVenueId === venueId && venueStore.config) return true;
    try {
      await venueStore.selectVenue(venueId);
    } catch {
      return { name: "museums", query: { reason: "museum-unavailable" } };
    }
  }
  return true;
});
