import { createRouter, createWebHistory } from "vue-router";
import PlaceholderView from "../ui/PlaceholderView.vue";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", name: "home", component: PlaceholderView, props: { title: "ArtAround Navigator" } },
    { path: "/library", name: "library", component: PlaceholderView, props: { title: "Library" } },
    { path: "/visits/:visitId", name: "visit-detail", component: PlaceholderView, props: { title: "Visit detail" } },
    { path: "/generate", name: "generate", component: PlaceholderView, props: { title: "Generate" } },
    { path: "/generated-plans/:planId", name: "generated-plan", component: PlaceholderView, props: { title: "Generated plan" } },
    { path: "/sessions/:sessionId", name: "session", component: PlaceholderView, props: { title: "Visit session" } },
    { path: "/:pathMatch(.*)*", name: "not-found", component: PlaceholderView, props: { title: "Pagina non trovata" } },
  ],
});
