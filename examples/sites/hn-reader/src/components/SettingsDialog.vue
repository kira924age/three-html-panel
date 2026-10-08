<script setup lang="ts">
import { mdiClose } from "@mdi/js";
import { settings, type ThemeChoice } from "../composables/settings";

const open = defineModel<boolean>({ required: true });

const pageSizes = [10, 20, 30, 50];
const themes: { title: string; value: ThemeChoice }[] = [
  { title: "Light", value: "light" },
  { title: "Dark", value: "dark" },
  { title: "Follow the system", value: "system" },
];
</script>

<template>
  <v-dialog v-model="open" max-width="520" scrollable>
    <v-card rounded="lg" class="settings-dialog">
      <v-card-title class="d-flex align-center pe-2">
        <span>Settings</span>
        <v-spacer />
        <v-btn
          :icon="mdiClose"
          variant="text"
          size="small"
          aria-label="Close"
          @click="open = false"
        />
      </v-card-title>
      <v-divider />

      <v-card-text>
        <v-select
          v-model="settings.pageSize"
          :items="pageSizes"
          label="Stories loaded at a time"
          variant="outlined"
          density="comfortable"
          class="page-size mb-2"
          hint="Applies to the next load"
          persistent-hint
        />
        <v-select
          v-model="settings.theme"
          :items="themes"
          label="Theme"
          variant="outlined"
          density="comfortable"
          class="theme-select mb-2"
          hide-details
        />

        <v-switch
          v-model="settings.compact"
          label="Compact story list"
          color="primary"
          inset
          hide-details
          class="compact-switch"
        />
        <v-switch
          v-model="settings.showDomains"
          label="Show link domains"
          color="primary"
          inset
          hide-details
        />

        <div class="mt-4">
          <div class="text-label-large">
            Expand replies down to level {{ settings.expandDepth }}
          </div>
          <div class="text-body-small text-medium-emphasis">
            Deeper replies start collapsed when a story opens.
          </div>
          <v-slider
            v-model="settings.expandDepth"
            :min="1"
            :max="8"
            :step="1"
            show-ticks="always"
            color="primary"
            thumb-label
            hide-details
            class="depth-slider"
          />
        </div>
      </v-card-text>

      <v-divider />
      <v-card-actions>
        <span class="text-body-small text-medium-emphasis ps-2"
          >Settings last for this visit only.</span
        >
        <v-spacer />
        <v-btn color="primary" variant="flat" @click="open = false">Done</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
