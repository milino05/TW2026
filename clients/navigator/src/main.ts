import { createApp } from "vue";
import { createPinia, setActivePinia } from "pinia";
import App from "./ui/App.vue";
import { router } from "./application/router";
import { useConfiguredVenueStore } from "./application/stores";
import { loadNavigatorStaticConfig } from "./domain/navigatorStaticConfig";

async function bootstrap() {
  const pinia = createPinia();
  setActivePinia(pinia);

  const config = await loadNavigatorStaticConfig();
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
