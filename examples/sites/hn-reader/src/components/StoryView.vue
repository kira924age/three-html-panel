<script setup lang="ts">
import { computed, onBeforeUnmount, provide, ref, watch } from "vue";
import {
  mdiArrowUpBold,
  mdiClockOutline,
  mdiCommentOutline,
  mdiOpenInNew,
  mdiUnfoldLessHorizontal,
  mdiUnfoldMoreHorizontal,
  mdiAlertCircleOutline,
  mdiCommentRemoveOutline,
} from "@mdi/js";
import { fetchItem, fetchThread, type Item, type ThreadNode } from "../api/hn";
import CommentItem from "./CommentItem.vue";
import UserMenu from "./UserMenu.vue";
import { notifyError } from "../composables/notify";
import { createThreadContext, ThreadKey } from "../composables/thread";
import { domainOf, formatCount, formatDateTime, hnLink, timeAgo } from "../utils/format";
import { sanitize } from "../utils/html";

const props = defineProps<{ id: number }>();

const PAGE = 15;

const story = ref<Item | null>(null);
const storyStatus = ref<"loading" | "ready" | "error">("loading");
const comments = ref<ThreadNode[]>([]);
const commentsStatus = ref<"loading" | "ready" | "error">("loading");
const shown = ref(PAGE);
const thread = createThreadContext(null);
provide(ThreadKey, thread);

let controller: AbortController | undefined;

async function load(id: number): Promise<void> {
  controller?.abort();
  controller = new AbortController();
  const { signal } = controller;
  storyStatus.value = "loading";
  commentsStatus.value = "loading";
  shown.value = PAGE;
  comments.value = [];
  try {
    story.value = await fetchItem(id, { fresh: true });
    thread.op = story.value?.by ?? null;
    storyStatus.value = "ready";
  } catch (error) {
    storyStatus.value = "error";
    notifyError(error, { label: "Retry", run: () => load(id) });
    return;
  }
  try {
    const nodes = await fetchThread(id, signal);
    if (signal.aborted) return;
    comments.value = nodes;
    commentsStatus.value = "ready";
  } catch (error) {
    if ((error as Error).name === "AbortError") return;
    commentsStatus.value = "error";
    notifyError(error);
  }
}

watch(() => props.id, load, { immediate: true });
onBeforeUnmount(() => controller?.abort());

const domain = computed(() => domainOf(story.value?.url));
const text = computed(() => sanitize(story.value?.text));

function setAll(collapsed: boolean): void {
  thread.collapsed = collapsed;
  thread.version++;
}
</script>

<template>
  <div class="story">
    <v-card variant="flat" border rounded="lg" class="mb-4">
      <v-skeleton-loader v-if="storyStatus === 'loading'" type="heading, subtitle, paragraph" />

      <v-empty-state
        v-else-if="storyStatus === 'error'"
        :icon="mdiAlertCircleOutline"
        title="Could not load the story"
        size="64"
      >
        <template #actions>
          <v-btn color="primary" variant="flat" @click="load(id)">Retry</v-btn>
        </template>
      </v-empty-state>

      <v-card-text v-else-if="!story" class="text-body-large"
        >This story does not exist.</v-card-text
      >

      <template v-else>
        <v-card-item>
          <h1 class="text-headline-small story-title">{{ story.title }}</h1>
          <div
            class="d-flex align-center flex-wrap ga-3 mt-2 text-body-medium text-medium-emphasis"
          >
            <v-chip
              v-if="domain"
              :href="story.url"
              target="_blank"
              rel="noopener"
              :append-icon="mdiOpenInNew"
              color="secondary"
              variant="tonal"
              label
            >
              {{ domain }}
            </v-chip>
            <span class="d-inline-flex align-center ga-1"
              ><v-icon :icon="mdiArrowUpBold" size="16" />{{
                formatCount(story.score ?? 0)
              }}
              points</span
            >
            <span v-if="story.by" class="d-inline-flex align-center ga-1"
              >by <UserMenu :name="story.by" highlight
            /></span>
            <span class="d-inline-flex align-center ga-1" :title="formatDateTime(story.time)">
              <v-icon :icon="mdiClockOutline" size="16" />{{ timeAgo(story.time) }}
            </span>
            <span class="d-inline-flex align-center ga-1">
              <v-icon :icon="mdiCommentOutline" size="16" />{{
                formatCount(story.descendants ?? 0)
              }}
              comments
            </span>
          </div>
        </v-card-item>

        <v-card-text v-if="story.text" class="hn-text text-body-large story-text" v-html="text" />

        <v-card-actions class="px-4 pb-3">
          <v-btn
            v-if="story.url"
            :href="story.url"
            target="_blank"
            rel="noopener"
            color="primary"
            variant="flat"
            :append-icon="mdiOpenInNew"
          >
            Read the article
          </v-btn>
          <v-btn
            :href="hnLink(story.id)"
            target="_blank"
            rel="noopener"
            variant="tonal"
            :append-icon="mdiOpenInNew"
          >
            Discuss on HN
          </v-btn>
        </v-card-actions>
      </template>
    </v-card>

    <v-card v-if="storyStatus === 'ready' && story" variant="flat" border rounded="lg">
      <v-toolbar density="compact" color="transparent" class="px-2">
        <v-toolbar-title class="text-title-medium">Comments</v-toolbar-title>
        <v-btn
          :prepend-icon="mdiUnfoldLessHorizontal"
          size="small"
          variant="text"
          class="collapse-all"
          @click="setAll(true)"
          >Collapse all</v-btn
        >
        <v-btn
          :prepend-icon="mdiUnfoldMoreHorizontal"
          size="small"
          variant="text"
          class="expand-all"
          @click="setAll(false)"
          >Expand all</v-btn
        >
      </v-toolbar>
      <v-divider />

      <div class="px-4 pb-4">
        <template v-if="commentsStatus === 'loading'">
          <v-skeleton-loader v-for="n in 4" :key="n" type="list-item-avatar-three-line" />
        </template>
        <v-alert
          v-else-if="commentsStatus === 'error'"
          type="error"
          variant="tonal"
          class="mt-4"
          title="Could not load the comments"
        >
          <v-btn variant="text" size="small" @click="load(id)">Retry</v-btn>
        </v-alert>
        <v-empty-state
          v-else-if="!comments.length"
          :icon="mdiCommentRemoveOutline"
          title="No comments yet"
          size="48"
        />
        <template v-else>
          <CommentItem
            v-for="node in comments.slice(0, shown)"
            :key="node.id"
            :node="node"
            :depth="0"
          />
          <div v-if="comments.length > shown" class="text-center mt-4">
            <v-btn variant="tonal" color="primary" class="more-comments" @click="shown += PAGE">
              Show more comments ({{ comments.length - shown }} threads left)
            </v-btn>
          </div>
        </template>
      </div>
    </v-card>
  </div>
</template>

<style scoped>
.story-title {
  line-height: 1.25;
  overflow-wrap: anywhere;
}
.story-text {
  padding-top: 0;
}
</style>
