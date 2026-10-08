<script setup lang="ts">
import { computed, onMounted } from "vue";
import { mdiAlertCircleOutline, mdiFilterRemoveOutline } from "@mdi/js";
import type { Feed } from "../api/hn";
import { fromItem } from "../api/story";
import StoryCard from "./StoryCard.vue";
import { feedState, loadFeed, loadMore, useFeedItems } from "../composables/feeds";
import { notifyError } from "../composables/notify";
import { listOptions, settings } from "../composables/settings";
import { timeAgo } from "../utils/format";

const props = defineProps<{ feed: Feed }>();

const state = computed(() => feedState(props.feed));
const stories = useFeedItems(() => props.feed);

async function load(): Promise<void> {
  try {
    await loadFeed(props.feed);
  } catch (error) {
    notifyError(error, { label: "Retry", run: load });
  }
}

onMounted(() => {
  if (state.value.status === "idle" || state.value.status === "error") void load();
});

type Status = "ok" | "empty" | "loading" | "error";
async function onLoad({ done }: { done: (status: Status) => void }): Promise<void> {
  try {
    done((await loadMore(props.feed)) ? "ok" : "empty");
  } catch (error) {
    notifyError(error);
    done("error");
  }
}

function resetFilters(): void {
  Object.assign(listOptions, { sort: "rank", minScore: 0, linksOnly: false });
}
</script>

<template>
  <div class="feed">
    <template v-if="state.status === 'loading' || state.status === 'idle'">
      <v-card v-for="n in 6" :key="n" variant="flat" border rounded="lg" class="mb-2">
        <v-skeleton-loader type="list-item-two-line" />
      </v-card>
    </template>

    <v-empty-state
      v-else-if="state.status === 'error'"
      :icon="mdiAlertCircleOutline"
      title="Could not load the stories"
      text="Check your connection and try again."
    >
      <template #actions>
        <v-btn color="primary" variant="flat" @click="load">Retry</v-btn>
      </template>
    </v-empty-state>

    <template v-else>
      <div class="d-flex align-center mb-2 text-body-small text-medium-emphasis">
        <span>{{ state.items.length }} of {{ state.ids.length }} stories loaded</span>
        <v-spacer />
        <span>Updated {{ timeAgo(state.updated / 1000) }}</span>
      </div>

      <v-infinite-scroll
        :key="feed + settings.pageSize"
        class="stories"
        side="end"
        margin="300"
        @load="onLoad"
      >
        <StoryCard
          v-for="{ item, rank } in stories"
          :key="item.id"
          :story="fromItem(item)"
          :rank="rank"
        />

        <v-alert
          v-if="!stories.length"
          type="info"
          variant="tonal"
          :icon="mdiFilterRemoveOutline"
          title="No story matches the filters"
          class="mt-2"
        >
          More stories are loaded as you scroll, or
          <v-btn variant="text" size="small" @click="resetFilters">reset the filters</v-btn>
        </v-alert>

        <template #loading>
          <div class="w-100">
            <v-card v-for="n in 2" :key="n" variant="flat" border rounded="lg" class="mt-2">
              <v-skeleton-loader type="list-item-two-line" />
            </v-card>
          </div>
        </template>
        <template #empty>
          <div class="text-body-medium text-medium-emphasis py-4">
            That's all {{ state.ids.length }} stories.
          </div>
        </template>
        <template #error="{ props: retry }">
          <v-btn v-bind="retry" variant="tonal" color="error" class="my-4"
            >Could not load more. Retry</v-btn
          >
        </template>
      </v-infinite-scroll>
    </template>
  </div>
</template>

<style scoped>
.stories {
  overflow: visible;
}
.stories :deep(.v-infinite-scroll__side) {
  padding: 0;
}
</style>
