import { createApp } from "vue";
import { createPinia, setActivePinia } from "pinia";
import App from "./ui/App.vue";
import { router } from "./application/router";
import { useAuthStore, useConfiguredVenueStore } from "./application/stores";
import { loadNavigatorStaticConfig } from "./domain/navigatorStaticConfig";
import { authRepository } from "./infrastructure/http/authRepository";

async function bootstrap() {
  const pinia = createPinia();
  setActivePinia(pinia);

  const [config] = await Promise.all([
    loadNavigatorStaticConfig(),
    authRepository.me()
      .then((response) => useAuthStore().setUser(response.user))
      .catch(() => useAuthStore().clear()),
  ]);
  useConfiguredVenueStore().bootstrap(config);

  createApp(App)
    .use(pinia)
    .use(router)
    .mount("#app");
}

bootstrap().catch((error) => {
  const target = document.querySelector<HTMLDivElement>("#app");
  if (target) target.textContent = error instanceof Error ? error.message : "Errore di bootstrap Navigator";
});
