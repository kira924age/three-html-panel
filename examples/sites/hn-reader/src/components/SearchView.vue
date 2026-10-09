<script setup lang="ts">
import { ref, watch } from "vue";
import { mdiMagnifyRemoveOutline, mdiCommentTextOutline, mdiAlertCircleOutline } from "@mdi/js";
import { search, type SearchHit, type SearchKind, type SearchSort } from "../api/hn";
import { fromHit } from "../api/story";
import StoryCard from "./StoryCard.vue";
import UserMenu from "./UserMenu.vue";
import { openStory } from "../composables/navigation";
import { notifyError } from "../composables/notify";
import { formatCount, timeAgo } from "../utils/format";
import { toPlainText } from "../utils/html";

const props = defineProps<{ query: string }>();

const sort = ref<SearchSort>("relevance");
const kind = ref<SearchKind>("story");
const hits = ref<SearchHit[]>([]);
const total = ref(0);
const page = ref(0);
const pages = ref(0);
const status = ref<"loading" | "ready" | "error">("loading");
// Bumped for each new search, so that v-infinite-scroll starts over.
const generation = ref(0);

let controller: AbortController | undefined;

async function run(): Promise<void> {
  controller?.abort();
  controller = new AbortController();
  const { signal } = controller;
  status.value = "loading";
  try {
    const result = await search(props.query, { sort: sort.value, kind: kind.value, signal });
    hits.value = result.hits;
    total.value = result.total;
    page.value = 0;
    pages.value = result.pages;
    status.value = "ready";
    generation.value++;
  } catch (error) {
    if ((error as Error).name === "AbortError") return;
    status.value = "error";
    notifyError(error, { label: "Retry", run });
  }
}

watch([() => props.query, sort, kind], run, { immediate: true });

type Status = "ok" | "empty" | "loading" | "error";
async function onLoad({ done }: { done: (status: Status) => void }): Promise<void> {
  if (status.value !== "ready") return done("ok");
  if (page.value + 1 >= pages.value) return done("empty");
  try {
    const result = await search(props.query, {
      sort: sort.value,
      kind: kind.value,
      page: page.value + 1,
    });
    const seen = new Set(hits.value.map((h) => h.id));
    hits.value.push(...result.hits.filter((h) => !seen.has(h.id)));
    page.value = result.page;
    done(page.value + 1 >= pages.value ? "empty" : "ok");
  } catch (error) {
    notifyError(error);
    done("error");
  }
}

function snippet(hit: SearchHit): string {
  const text = toPlainText(hit.text);
  return text.length > 280 ? `${text.slice(0, 280)}…` : text;
}
</script>

<template>
  <div class="search-view">
    <div class="d-flex align-center flex-wrap ga-3 mb-3">
      <div class="text-title-large">
        Results for <span class="font-weight-bold">“{{ query }}”</span>
      </div>
      <v-spacer />
      <v-chip-group v-model="kind" mandatory selected-class="text-primary" class="kind">
        <v-chip value="story" filter variant="outlined">Stories</v-chip>
        <v-chip value="comment" filter variant="outlined">Comments</v-chip>
      </v-chip-group>
      <v-btn-toggle
        v-model="sort"
        mandatory
        density="compact"
        variant="outlined"
        divided
        color="primary"
        class="sort"
      >
        <v-btn value="relevance" size="small">Popular</v-btn>
        <v-btn value="date" size="small">Recent</v-btn>
      </v-btn-toggle>
    </div>

    <template v-if="status === 'loading'">
      <v-card v-for="n in 5" :key="n" variant="flat" border rounded="lg" class="mb-2">
        <v-skeleton-loader type="list-item-two-line" />
      </v-card>
    </template>

    <v-empty-state
      v-else-if="status === 'error'"
      :icon="mdiAlertCircleOutline"
      title="Search failed"
    >
      <template #actions><v-btn color="primary" variant="flat" @click="run">Retry</v-btn></template>
    </v-empty-state>

    <v-empty-state
      v-else-if="!hits.length"
      :icon="mdiMagnifyRemoveOutline"
      title="Nothing found"
      :text="`No ${kind === 'story' ? 'stories' : 'comments'} match “${query}”.`"
    />

    <template v-else>
      <div class="text-body-small text-medium-emphasis mb-2">{{ formatCount(total) }} results</div>
      <v-infinite-scroll :key="generation" side="end" margin="300" class="results" @load="onLoad">
        <template v-if="kind === 'story'">
          <StoryCard v-for="hit in hits" :key="hit.id" :story="fromHit(hit)" />
        </template>
        <template v-else>
          <v-card
            v-for="hit in hits"
            :key="hit.id"
            variant="flat"
            border
            rounded="lg"
            class="comment-hit mb-2"
            :disabled="!hit.storyId"
            @click="hit.storyId && openStory(hit.storyId)"
          >
            <v-card-text>
              <div class="d-flex align-center ga-2 text-body-small text-medium-emphasis mb-1">
                <v-icon :icon="mdiCommentTextOutline" size="16" />
                <UserMenu :name="hit.author" />
                <span>{{ timeAgo(hit.time) }}</span>
                <span v-if="hit.storyTitle" class="text-truncate"
                  >on <strong>{{ hit.storyTitle }}</strong></span
                >
              </div>
              <div class="text-body-medium">{{ snippet(hit) }}</div>
            </v-card-text>
          </v-card>
        </template>

        <template #loading>
          <v-progress-circular indeterminate color="primary" class="my-4" />
        </template>
        <template #empty>
          <div class="text-body-medium text-medium-emphasis py-4">End of results.</div>
        </template>
      </v-infinite-scroll>
    </template>
  </div>
</template>

<style scoped>
.results {
  overflow: visible;
}
</style>
