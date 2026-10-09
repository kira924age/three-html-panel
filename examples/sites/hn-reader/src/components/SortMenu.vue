<script setup lang="ts">
import { mdiSortVariant, mdiCheck } from "@mdi/js";
import { computed } from "vue";
import { listOptions, SORT_LABELS, type SortOrder } from "../composables/settings";

const orders = Object.entries(SORT_LABELS) as [SortOrder, string][];
const active = computed(
  () => listOptions.sort !== "rank" || listOptions.minScore > 0 || listOptions.linksOnly,
);

function select(selected: unknown): void {
  const [value] = selected as SortOrder[];
  if (value) listOptions.sort = value;
}

function reset(): void {
  Object.assign(listOptions, { sort: "rank", minScore: 0, linksOnly: false });
}
</script>

<template>
  <v-menu location="bottom end" :close-on-content-click="false" offset="4">
    <template #activator="{ props }">
      <v-btn v-bind="props" icon aria-label="Sort and filter" class="sort-button">
        <v-badge :model-value="active" dot color="white">
          <v-icon :icon="mdiSortVariant" />
        </v-badge>
      </v-btn>
    </template>

    <v-card width="300" class="sort-menu">
      <v-list density="compact" :selected="[listOptions.sort]" mandatory @update:selected="select">
        <v-list-subheader>Sort loaded stories by</v-list-subheader>
        <v-list-item
          v-for="[value, label] in orders"
          :key="value"
          :value="value"
          :title="label"
          color="primary"
        >
          <template #append>
            <v-icon v-if="listOptions.sort === value" :icon="mdiCheck" size="small" />
          </template>
        </v-list-item>
      </v-list>
      <v-divider />
      <v-card-text class="pb-0">
        <div class="text-label-large mb-1">Minimum points: {{ listOptions.minScore }}</div>
        <v-slider
          v-model="listOptions.minScore"
          :min="0"
          :max="500"
          :step="10"
          color="primary"
          hide-details
          thumb-label
        />
        <v-switch
          v-model="listOptions.linksOnly"
          label="Only stories with links"
          color="primary"
          density="compact"
          hide-details
          inset
        />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" :disabled="!active" @click="reset">Reset</v-btn>
      </v-card-actions>
    </v-card>
  </v-menu>
</template>
