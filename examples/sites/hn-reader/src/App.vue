<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useTheme, useDisplay } from "vuetify";
import {
  mdiMagnify,
  mdiRefresh,
  mdiWeatherNight,
  mdiWeatherSunny,
  mdiCogOutline,
  mdiArrowLeft,
} from "@mdi/js";
import AppDrawer from "./components/AppDrawer.vue";
import FeedView from "./components/FeedView.vue";
import StoryView from "./components/StoryView.vue";
import SearchView from "./components/SearchView.vue";
import SettingsDialog from "./components/SettingsDialog.vue";
import SortMenu from "./components/SortMenu.vue";
import { FEEDS } from "./composables/feedList";
import { refreshFeed } from "./composables/feeds";
import { goBack, navigation, openFeed, openSearch } from "./composables/navigation";
import { notify, notifyError, snackbar } from "./composables/notify";
import { settings } from "./composables/settings";
import { useDebounced } from "./composables/debounce";
import type { Feed } from "./api/hn";

const theme = useTheme();
const { smAndDown } = useDisplay();

const drawer = ref(false);
const settingsOpen = ref(false);

// The theme: the settings' choice, "system" following the OS.
watch(
  () => settings.theme,
  (choice) => theme.change(choice, false),
  { immediate: true },
);
const isDark = computed(() => theme.current.value.dark);
function toggleTheme(): void {
  settings.theme = isDark.value ? "light" : "dark";
}

// Search: typing in the app bar's field opens the search view, debounced.
const searchText = ref("");
const query = useDebounced(searchText, 350);
watch(query, (q) => {
  const trimmed = (q ?? "").trim();
  if (trimmed) openSearch(trimmed);
  else if (navigation.view === "search") goBack();
});
function submitSearch(): void {
  const trimmed = (searchText.value ?? "").trim();
  if (trimmed) openSearch(trimmed);
}
function clearSearch(): void {
  searchText.value = "";
}

const tab = computed({
  get: () => (navigation.view === "feed" ? navigation.feed : null),
  set: (feed: Feed | null) => feed && openFeed(feed),
});

const refreshing = ref(false);
async function refresh(): Promise<void> {
  if (navigation.view !== "feed") {
    openFeed(navigation.feed);
    return;
  }
  refreshing.value = true;
  try {
    const fresh = await refreshFeed(navigation.feed);
    window.scrollTo({ top: 0, behavior: "smooth" });
    notify(
      fresh
        ? `Refreshed: ${fresh} new ${fresh === 1 ? "story" : "stories"}`
        : "Refreshed: you're up to date",
      {
        color: "success",
      },
    );
  } catch (error) {
    notifyError(error, { label: "Retry", run: refresh });
  } finally {
    refreshing.value = false;
  }
}

const title = computed(() => FEEDS.find((f) => f.id === navigation.feed)?.description ?? "");
</script>

<template>
  <v-app>
    <AppDrawer v-model="drawer" @settings="settingsOpen = true" />

    <v-app-bar color="primary" density="comfortable" elevation="2">
      <template #prepend>
        <v-app-bar-nav-icon aria-label="Menu" @click="drawer = !drawer" />
      </template>

      <button
        type="button"
        class="plain-button brand d-flex align-center ga-2 me-4"
        aria-label="Top stories"
        @click="openFeed('top')"
      >
        <span class="logo">Y</span>
        <span v-if="!smAndDown" class="text-title-large font-weight-bold">HN Reader</span>
      </button>

      <v-btn
        v-if="navigation.view !== 'feed'"
        :prepend-icon="mdiArrowLeft"
        variant="text"
        class="back-button me-2"
        @click="navigation.view === 'search' ? clearSearch() : goBack()"
      >
        Back
      </v-btn>

      <v-spacer />

      <v-text-field
        v-model="searchText"
        class="search me-2"
        type="text"
        inputmode="search"
        placeholder="Search stories"
        aria-label="Search Hacker News"
        :prepend-inner-icon="mdiMagnify"
        variant="solo-filled"
        density="compact"
        flat
        rounded
        hide-details
        clearable
        single-line
        @keydown.enter="submitSearch"
        @click:clear="clearSearch"
      />

      <v-tooltip text="Refresh" location="bottom">
        <template #activator="{ props }">
          <v-btn v-bind="props" icon :loading="refreshing" aria-label="Refresh" @click="refresh">
            <v-icon :icon="mdiRefresh" />
          </v-btn>
        </template>
      </v-tooltip>

      <SortMenu v-if="navigation.view === 'feed'" />

      <v-tooltip :text="isDark ? 'Light theme' : 'Dark theme'" location="bottom">
        <template #activator="{ props }">
          <v-btn
            v-bind="props"
            icon
            aria-label="Toggle theme"
            class="theme-toggle"
            @click="toggleTheme"
          >
            <v-icon :icon="isDark ? mdiWeatherSunny : mdiWeatherNight" />
          </v-btn>
        </template>
      </v-tooltip>

      <v-tooltip text="Settings" location="bottom">
        <template #activator="{ props }">
          <v-btn
            v-bind="props"
            icon
            aria-label="Settings"
            class="settings-button"
            @click="settingsOpen = true"
          >
            <v-icon :icon="mdiCogOutline" />
          </v-btn>
        </template>
      </v-tooltip>

      <template #extension>
        <v-tabs v-model="tab" class="feed-tabs" align-tabs="start" slider-color="white" show-arrows>
          <v-tab v-for="feed in FEEDS" :key="feed.id" :value="feed.id" :prepend-icon="feed.icon">
            {{ feed.title }}
          </v-tab>
        </v-tabs>
        <v-spacer />
        <span
          v-if="navigation.view === 'feed' && !smAndDown"
          class="text-label-large me-4 opacity-80"
          >{{ title }}</span
        >
      </template>
    </v-app-bar>

    <v-main>
      <v-container class="content py-4">
        <FeedView
          v-if="navigation.view === 'feed'"
          :key="navigation.feed"
          :feed="navigation.feed"
        />
        <StoryView
          v-else-if="navigation.view === 'story' && navigation.storyId"
          :id="navigation.storyId"
        />
        <SearchView v-else-if="navigation.view === 'search'" :query="navigation.query" />
      </v-container>
    </v-main>

    <SettingsDialog v-model="settingsOpen" />

    <v-snackbar
      v-model="snackbar.show"
      :color="snackbar.color || undefined"
      timeout="4000"
      location="bottom"
    >
      {{ snackbar.text }}
      <template #actions>
        <v-btn
          v-if="snackbar.action"
          variant="text"
          @click="
            snackbar.show = false;
            snackbar.action.run();
          "
        >
          {{ snackbar.action.label }}
        </v-btn>
        <v-btn variant="text" @click="snackbar.show = false">Close</v-btn>
      </template>
    </v-snackbar>
  </v-app>
</template>

<style>
.content {
  max-width: 920px;
}
/* A <button> that looks like text (Vuetify 4's reset keeps the native look). */
.plain-button {
  appearance: none;
  background: none;
  border: 0;
  padding: 0;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.brand {
  white-space: nowrap;
}
.brand .logo {
  display: inline-grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border: 2px solid currentColor;
  border-radius: 6px;
  font-weight: 800;
  font-family: Verdana, sans-serif;
}
.search {
  max-width: 320px;
  min-width: 160px;
}
.feed-tabs .v-tab {
  text-transform: none;
}
/* HN's HTML (comments, Ask HN texts, profiles) */
.hn-text {
  overflow-wrap: anywhere;
  line-height: 1.5;
}
.hn-text p {
  margin-top: 0.6em;
}
.hn-text a {
  color: rgb(var(--v-theme-primary));
}
.hn-text pre {
  white-space: pre-wrap;
  font-size: 0.85em;
  padding: 8px 10px;
  margin: 0.6em 0;
  border-radius: 6px;
  background: rgba(var(--v-theme-on-surface), 0.06);
}
</style>
