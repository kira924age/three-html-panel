<script setup lang="ts">
import { ref, watch } from "vue";
import {
  mdiAccountCircleOutline,
  mdiOpenInNew,
  mdiStarCircleOutline,
  mdiCalendarOutline,
} from "@mdi/js";
import { fetchUser, type User } from "../api/hn";
import { formatCount, formatDate, hnLink, timeAgo } from "../utils/format";
import { sanitize } from "../utils/html";

const props = defineProps<{ name: string; highlight?: boolean }>();

const open = ref(false);
const user = ref<User | null>(null);
const status = ref<"idle" | "loading" | "ready" | "error">("idle");

async function load(): Promise<void> {
  status.value = "loading";
  try {
    user.value = await fetchUser(props.name);
    status.value = "ready";
  } catch {
    status.value = "error";
  }
}

watch(open, (isOpen) => {
  if (isOpen && status.value !== "ready" && status.value !== "loading") void load();
});
</script>

<template>
  <v-menu v-model="open" location="bottom start" :close-on-content-click="false" offset="4">
    <template #activator="{ props: activator }">
      <button
        v-bind="activator"
        type="button"
        class="plain-button user-link"
        :class="{ highlight }"
        :aria-label="`Profile of ${name}`"
        @click.stop
      >
        {{ name }}
      </button>
    </template>

    <v-card width="320" class="user-card">
      <v-card-item>
        <template #prepend>
          <v-avatar color="primary" variant="tonal">
            <span class="text-title-medium">{{ name.slice(0, 1).toUpperCase() }}</span>
          </v-avatar>
        </template>
        <v-card-title>{{ name }}</v-card-title>
        <v-card-subtitle>Hacker News user</v-card-subtitle>
      </v-card-item>

      <v-card-text v-if="status === 'loading' || status === 'idle'">
        <v-skeleton-loader type="list-item-two-line" />
      </v-card-text>
      <v-card-text v-else-if="status === 'error'" class="text-error">
        Could not load the profile.
        <v-btn size="small" variant="text" @click="load">Retry</v-btn>
      </v-card-text>
      <v-card-text v-else-if="!user">This user does not exist.</v-card-text>
      <template v-else>
        <v-list density="compact" class="py-0">
          <v-list-item
            :prepend-icon="mdiStarCircleOutline"
            :title="formatCount(user.karma)"
            subtitle="Karma"
          />
          <v-list-item
            :prepend-icon="mdiCalendarOutline"
            :title="formatDate(user.created)"
            :subtitle="`Joined ${timeAgo(user.created)}`"
          />
          <v-list-item
            v-if="user.submitted"
            :prepend-icon="mdiAccountCircleOutline"
            :title="formatCount(user.submitted.length)"
            subtitle="Submissions and comments"
          />
        </v-list>
        <v-card-text v-if="user.about" class="pt-1">
          <div class="about hn-text text-body-medium" v-html="sanitize(user.about)" />
        </v-card-text>
      </template>

      <v-card-actions>
        <v-spacer />
        <v-btn
          :href="hnLink(name, 'user')"
          target="_blank"
          rel="noopener"
          :append-icon="mdiOpenInNew"
          variant="text"
        >
          Profile on HN
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-menu>
</template>

<style scoped>
.user-link {
  font-weight: 600;
}
.user-link.highlight {
  color: rgb(var(--v-theme-primary));
}
.user-link:hover {
  text-decoration: underline;
}
.about {
  max-height: 140px;
  overflow: auto;
}
</style>
