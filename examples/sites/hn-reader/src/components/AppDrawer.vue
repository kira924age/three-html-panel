<script setup lang="ts">
import { mdiCogOutline, mdiOpenInNew, mdiGithub, mdiInformationOutline } from "@mdi/js";
import { FEEDS } from "../composables/feedList";
import { navigation, openFeed } from "../composables/navigation";
import type { Feed } from "../api/hn";

const open = defineModel<boolean>({ required: true });
const emit = defineEmits<{ settings: [] }>();

function choose(feed: Feed): void {
  openFeed(feed);
  open.value = false;
}
function settings(): void {
  open.value = false;
  emit("settings");
}
</script>

<template>
  <v-navigation-drawer v-model="open" temporary width="280">
    <div class="pa-4 d-flex align-center ga-3">
      <v-avatar color="primary" rounded="lg" size="40">
        <span class="text-title-medium font-weight-bold">Y</span>
      </v-avatar>
      <div>
        <div class="text-title-medium font-weight-bold">HN Reader</div>
        <div class="text-body-small text-medium-emphasis">Hacker News, in Vuetify</div>
      </div>
    </div>
    <v-divider />

    <v-list
      nav
      density="comfortable"
      :selected="navigation.view === 'feed' ? [navigation.feed] : []"
    >
      <v-list-subheader>Feeds</v-list-subheader>
      <v-list-item
        v-for="feed in FEEDS"
        :key="feed.id"
        :value="feed.id"
        :prepend-icon="feed.icon"
        :title="feed.title"
        :subtitle="feed.description"
        color="primary"
        rounded="lg"
        @click="choose(feed.id)"
      />
    </v-list>

    <v-divider class="my-1" />

    <v-list nav density="comfortable">
      <v-list-item :prepend-icon="mdiCogOutline" title="Settings" rounded="lg" @click="settings" />
      <v-list-item
        :prepend-icon="mdiOpenInNew"
        title="news.ycombinator.com"
        href="https://news.ycombinator.com/"
        target="_blank"
        rel="noopener"
        rounded="lg"
      />
      <v-list-item
        :prepend-icon="mdiGithub"
        title="HN API"
        href="https://github.com/HackerNews/API"
        target="_blank"
        rel="noopener"
        rounded="lg"
      />
    </v-list>

    <template #append>
      <div class="pa-4 text-body-small text-medium-emphasis d-flex ga-2">
        <v-icon :icon="mdiInformationOutline" size="small" />
        <span>Data from the official HN API and Algolia search. Nothing is stored.</span>
      </div>
    </template>
  </v-navigation-drawer>
</template>
