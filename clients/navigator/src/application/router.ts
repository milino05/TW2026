import { createRouter, createWebHistory } from "vue-router";
import { useAuthStore } from "./stores";
import LoginView from "../ui/LoginView.vue";
import LibraryView from "../ui/LibraryView.vue";
import VisitDetailView from "../ui/VisitDetailView.vue";
import SessionView from "../ui/SessionView.vue";
import PlaceholderView from "../ui/PlaceholderView.vue";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", name: "home", component: LoginView },
    { path: "/library", name: "library", component: LibraryView, meta: { requiresAuth: true } },
    { path: "/visits/:visitId", name: "visit-detail", component: VisitDetailView, meta: { requiresAuth: true } },
    { path: "/generate", name: "generate", component: PlaceholderView, props: { title: "Generate" }, meta: { requiresAuth: true } },
    { path: "/generated-plans/:planId", name: "generated-plan", component: PlaceholderView, props: { title: "Generated plan" }, meta: { requiresAuth: true } },
    { path: "/sessions/:sessionId", name: "session", component: SessionView, meta: { requiresAuth: true } },
    { path: "/:pathMatch(.*)*", name: "not-found", component: PlaceholderView, props: { title: "Pagina non trovata" } },
  ],
});

router.beforeEach((to) => {
  const auth = useAuthStore();
  if (to.meta.requiresAuth && !auth.authenticated) return { name: "home" };
  if (to.name === "home" && auth.authenticated) return { name: "library" };
  return true;
});
