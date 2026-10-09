<script setup lang="ts">
import { computed } from "vue";
import {
  mdiArrowUpBold,
  mdiCommentOutline,
  mdiClockOutline,
  mdiOpenInNew,
  mdiBriefcaseOutline,
} from "@mdi/js";
import type { StorySummary } from "../api/story";
import UserMenu from "./UserMenu.vue";
import { openStory } from "../composables/navigation";
import { settings } from "../composables/settings";
import { domainOf, formatCount, formatDateTime, timeAgo } from "../utils/format";

const props = defineProps<{ story: StorySummary; rank?: number }>();

const domain = computed(() => domainOf(props.story.url));
const hot = computed(() => props.story.score >= 300);
</script>

<template>
  <v-card
    class="story-card"
    :class="{ compact: settings.compact }"
    :data-id="story.id"
    variant="flat"
    border
    rounded="lg"
    @click="openStory(story.id)"
  >
    <div class="d-flex align-start" :class="settings.compact ? 'pa-2 ga-2' : 'pa-3 ga-3'">
      <div
        v-if="rank"
        class="rank text-medium-emphasis"
        :class="settings.compact ? 'text-label-large' : 'text-title-medium'"
      >
        {{ rank }}
      </div>

      <div class="flex-grow-1 min-w-0">
        <div class="d-flex align-center flex-wrap ga-2">
          <v-icon
            v-if="story.kind === 'job'"
            :icon="mdiBriefcaseOutline"
            size="small"
            color="secondary"
          />
          <span class="title" :class="settings.compact ? 'text-body-large' : 'text-title-medium'">{{
            story.title
          }}</span>
          <v-chip
            v-if="domain && settings.showDomains"
            :href="story.url ?? undefined"
            target="_blank"
            rel="noopener"
            :append-icon="mdiOpenInNew"
            variant="tonal"
            color="secondary"
            label
            class="domain"
            @click.stop
          >
            {{ domain }}
          </v-chip>
        </div>

        <div
          class="meta text-body-small text-medium-emphasis d-flex align-center flex-wrap"
          :class="settings.compact ? 'mt-0 ga-2' : 'mt-1 ga-3'"
        >
          <span
            class="d-inline-flex align-center ga-1"
            :class="{ 'text-primary font-weight-bold': hot }"
          >
            <v-icon :icon="mdiArrowUpBold" size="14" />{{ formatCount(story.score) }} points
          </span>
          <span v-if="story.by" class="d-inline-flex align-center ga-1"
            >by <UserMenu :name="story.by"
          /></span>
          <span class="d-inline-flex align-center ga-1" :title="formatDateTime(story.time)">
            <v-icon :icon="mdiClockOutline" size="14" />{{ timeAgo(story.time) }}
          </span>
          <span v-if="story.kind !== 'job'" class="d-inline-flex align-center ga-1">
            <v-icon :icon="mdiCommentOutline" size="14" />{{ formatCount(story.comments) }}
            {{ story.comments === 1 ? "comment" : "comments" }}
          </span>
        </div>
      </div>

      <v-btn
        v-if="story.url && !settings.compact"
        :href="story.url"
        target="_blank"
        rel="noopener"
        icon
        variant="text"
        size="small"
        :aria-label="`Open ${domain ?? 'link'} in a new tab`"
        class="open-link"
        @click.stop
      >
        <v-icon :icon="mdiOpenInNew" />
      </v-btn>
    </div>
  </v-card>
</template>

<style scoped>
.story-card + .story-card {
  margin-top: 8px;
}
.story-card.compact + .story-card.compact {
  margin-top: 4px;
}
.rank {
  min-width: 28px;
  text-align: end;
  font-variant-numeric: tabular-nums;
}
.title {
  font-weight: 500;
  line-height: 1.3;
}
.min-w-0 {
  min-width: 0;
}
</style>
