<script setup lang="ts">
import { api } from "~~/convex/_generated/api";
import type { Id } from "~~/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

definePageMeta({ middleware: "auth", layout: "dashboard" });
usePermissionGuard({ permission: "lead.review.options.manage", redirectTo: "/" });

type ReviewDecision = "CONFIRMED" | "DENIED";

const optionsQuery = useConvexQuery(
  api.publications.leadReviewOptionMutations.listLeadReviewOptions,
  {},
);
const options = computed(() => optionsQuery.data.value ?? []);
const loading = computed(() => optionsQuery.status.value === "pending");

const { mutate: upsertLeadReviewOption } = useConvexMutation(
  api.publications.leadReviewOptionMutations.upsertLeadReviewOption,
);
const { mutate: setLeadReviewOptionActive } = useConvexMutation(
  api.publications.leadReviewOptionMutations.setLeadReviewOptionActive,
);
const { mutate: deleteLeadReviewOption } = useConvexMutation(
  api.publications.leadReviewOptionMutations.deleteLeadReviewOption,
);
const { mutate: seedDefaultLeadReviewOptions } = useConvexMutation(
  api.publications.leadReviewOptionMutations.seedDefaultLeadReviewOptions,
);

const form = reactive({
  decision: "CONFIRMED" as ReviewDecision,
  tag: "",
  label: "",
  isActive: true,
});
const saving = ref(false);
const seeding = ref(false);
const rowPendingId = ref<Id<"leadReviewOptions"> | null>(null);
const errorMessage = ref<string | null>(null);

async function saveOption() {
  if (saving.value) return;
  saving.value = true;
  errorMessage.value = null;
  try {
    await upsertLeadReviewOption({
      decision: form.decision,
      tag: form.tag,
      label: form.label,
      isActive: form.isActive,
    });
    form.tag = "";
    form.label = "";
    form.isActive = true;
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "Failed to save option";
  } finally {
    saving.value = false;
  }
}

async function seedDefaults() {
  if (seeding.value) return;
  seeding.value = true;
  errorMessage.value = null;
  try {
    await seedDefaultLeadReviewOptions({});
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "Failed to seed defaults";
  } finally {
    seeding.value = false;
  }
}

async function toggleOption(optionId: Id<"leadReviewOptions">, isActive: boolean) {
  if (rowPendingId.value) return;
  rowPendingId.value = optionId;
  errorMessage.value = null;
  try {
    await setLeadReviewOptionActive({
      optionId,
      isActive,
    });
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "Failed to update option";
  } finally {
    rowPendingId.value = null;
  }
}

async function removeOption(optionId: Id<"leadReviewOptions">) {
  if (rowPendingId.value) return;
  rowPendingId.value = optionId;
  errorMessage.value = null;
  try {
    await deleteLeadReviewOption({ optionId });
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "Failed to delete option";
  } finally {
    rowPendingId.value = null;
  }
}
</script>

<template>
  <main class="min-h-dvh px-4 py-6 sm:px-6 lg:px-8">
    <div class="mx-auto container space-y-6">
      <header class="rounded-2xl border border-border/70 bg-card/90 p-5 shadow-sm">
        <h1 class="text-2xl font-semibold tracking-tight sm:text-3xl">
          AI Lead Review Tags
        </h1>
        <p class="text-muted-foreground mt-1 text-sm">
          Manage confirm/deny tag options stored in Convex.
        </p>
      </header>

      <section class="grid gap-4 rounded-2xl border border-border/70 bg-card/90 p-5 shadow-sm">
        <div class="flex items-center justify-between gap-2">
          <h2 class="text-lg font-semibold">Add or Update Option</h2>
          <Button variant="outline" :disabled="seeding" @click="seedDefaults">
            {{ seeding ? "Seeding..." : "Seed Defaults" }}
          </Button>
        </div>

        <form class="grid gap-3 md:grid-cols-2" @submit.prevent="saveOption">
          <div class="grid gap-2">
            <Label for="decision">Decision</Label>
            <select
              id="decision"
              v-model="form.decision"
              class="border-input bg-background ring-offset-background focus-visible:ring-ring inline-flex h-10 w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none dark:bg-input/45"
            >
              <option value="CONFIRMED">CONFIRMED</option>
              <option value="DENIED">DENIED</option>
            </select>
          </div>

          <div class="grid gap-2">
            <Label for="is-active">Active</Label>
            <label
              id="is-active"
              class="inline-flex h-10 items-center gap-2 rounded-md border border-input px-3 text-sm"
            >
              <input v-model="form.isActive" type="checkbox" class="size-4" />
              Enable option
            </label>
          </div>

          <div class="grid gap-2">
            <Label for="tag">Tag Key</Label>
            <Input
              id="tag"
              v-model="form.tag"
              placeholder="ERP_IMPORTED"
              required
            />
          </div>

          <div class="grid gap-2">
            <Label for="label">Display Label</Label>
            <Input
              id="label"
              v-model="form.label"
              placeholder="ERP Imported"
              required
            />
          </div>

          <div class="md:col-span-2">
            <Button type="submit" :disabled="saving">
              {{ saving ? "Saving..." : "Save Option" }}
            </Button>
          </div>
        </form>

        <p v-if="errorMessage" class="text-sm text-red-700">
          {{ errorMessage }}
        </p>
      </section>

      <section class="rounded-2xl border border-border/70 bg-card/90 p-5 shadow-sm">
        <h2 class="mb-3 text-lg font-semibold">Configured Options</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Decision</TableHead>
              <TableHead>Tag</TableHead>
              <TableHead>Label</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableEmpty v-if="loading">Loading options...</TableEmpty>
            <TableEmpty v-else-if="options.length === 0">No options configured.</TableEmpty>
            <TableRow v-for="option in options" v-else :key="option._id">
              <TableCell>{{ option.decision }}</TableCell>
              <TableCell class="font-mono text-xs">{{ option.tag }}</TableCell>
              <TableCell>{{ option.label }}</TableCell>
              <TableCell>
                <Badge variant="secondary">
                  {{ option.isActive ? "Active" : "Inactive" }}
                </Badge>
              </TableCell>
              <TableCell class="space-x-2">
                <Button
                  size="xs"
                  variant="outline"
                  :disabled="rowPendingId === option._id"
                  @click="toggleOption(option._id, !option.isActive)"
                >
                  {{ option.isActive ? "Disable" : "Enable" }}
                </Button>
                <Button
                  size="xs"
                  variant="destructive"
                  :disabled="rowPendingId === option._id"
                  @click="removeOption(option._id)"
                >
                  Delete
                </Button>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </section>
    </div>
  </main>
</template>
