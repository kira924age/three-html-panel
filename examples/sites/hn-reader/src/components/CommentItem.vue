<script setup lang="ts">
import { computed, inject, ref, watch } from "vue";
import { mdiChevronDown, mdiChevronRight, mdiOpenInNew } from "@mdi/js";
import type { ThreadNode } from "../api/hn";
import UserMenu from "./UserMenu.vue";
import { countReplies, ThreadKey } from "../composables/thread";
import { settings } from "../composables/settings";
import { formatDateTime, hnLink, plural, timeAgo } from "../utils/format";
import { sanitize } from "../utils/html";

const props = defineProps<{ node: ThreadNode; depth: number }>();
const thread = inject(ThreadKey)!;

const collapsed = ref(props.depth >= settings.expandDepth);
watch(
  () => thread.version,
  () => (collapsed.value = thread.collapsed),
);

const replies = computed(() => countReplies(props.node));
const html = computed(() => sanitize(props.node.text));
const isOp = computed(() => !!props.node.author && props.node.author === thread.op);
</script>

<template>
  <div class="comment" :class="[`depth-${depth % 6}`, { collapsed }]" :data-id="node.id">
    <div class="header d-flex align-center ga-2 text-body-small">
      <v-btn
        :icon="collapsed ? mdiChevronRight : mdiChevronDown"
        size="x-small"
        variant="text"
        density="comfortable"
        class="toggle"
        :aria-label="collapsed ? 'Expand comment' : 'Collapse comment'"
        :aria-expanded="!collapsed"
        @click="collapsed = !collapsed"
      />
      <UserMenu v-if="node.author" :name="node.author" :highlight="isOp" />
      <span v-else class="text-disabled">[deleted]</span>
      <v-chip v-if="isOp" size="x-small" color="primary" variant="tonal" label>OP</v-chip>
      <span class="text-medium-emphasis" :title="formatDateTime(node.time)">{{
        timeAgo(node.time)
      }}</span>
      <a
        :href="hnLink(node.id)"
        target="_blank"
        rel="noopener"
        class="permalink text-medium-emphasis"
        aria-label="Open on HN"
      >
        <v-icon :icon="mdiOpenInNew" size="12" />
      </a>
      <button
        v-if="collapsed && replies"
        type="button"
        class="plain-button more"
        @click="collapsed = false"
      >
        +{{ plural(replies, "reply", "replies") }}
      </button>
    </div>

    <template v-if="!collapsed">
      <div v-if="node.text" class="body hn-text text-body-medium" v-html="html" />
      <div v-if="node.children.length" class="children">
        <CommentItem
          v-for="child in node.children"
          :key="child.id"
          :node="child"
          :depth="depth + 1"
        />
      </div>
    </template>
  </div>
</template>

<style scoped>
.comment {
  --line: rgba(var(--v-theme-on-surface), 0.12);
  padding-top: 8px;
}
.children {
  margin-left: 11px;
  padding-left: 14px;
  border-left: 2px solid var(--line);
}
.depth-1 > .children,
.depth-0 > .children {
  --line: rgba(var(--v-theme-primary), 0.45);
}
.depth-1 > .children {
  --line: rgba(var(--v-theme-secondary), 0.45);
}
.depth-2 > .children {
  --line: rgba(var(--v-theme-success), 0.45);
}
.depth-3 > .children {
  --line: rgba(var(--v-theme-info), 0.45);
}
.depth-4 > .children {
  --line: rgba(var(--v-theme-warning), 0.45);
}
.body {
  padding-left: 32px;
  padding-right: 8px;
}
.body :deep(p:first-child) {
  margin-top: 0;
}
.toggle {
  margin-left: -4px;
}
.more {
  font-weight: 600;
  color: rgb(var(--v-theme-primary));
}
.permalink {
  display: inline-flex;
}
</style>
