// The agent first: it must run before any other module's top level.
import "./agent";

import { createApp } from "vue";
import App from "./App.vue";
import { vuetify } from "./plugins/vuetify";

createApp(App).use(vuetify).mount("#app");
