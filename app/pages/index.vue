<script setup lang="ts">
import { api } from "~~/convex/_generated/api";
import type { Id } from "~~/convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

const {
  results: publications,
  status,
  loadMore,
  isLoading,
} = useConvexPaginatedQuery(
  api.publications.publicationQueries.listPublications,
  {},
  { initialNumItems: 20 },
);

const { upload, pending, error } = useConvexFileUpload(
  api.files.generateUploadUrl,
  {
    allowedTypes: ["application/pdf"],
    maxSize: 250 * 1024 * 1024,
  },
);
const { mutate: createPublication } = useConvexMutation(
  api.publications.publicationMutations.createPublicationUpload,
);

const loadMoreRef = ref<HTMLElement | null>(null);
const fileInputRef = ref<HTMLInputElement | null>(null);
const selectedFileCount = ref(0);
const batchSize = 20;
const loadedRows = computed(() => publications.value ?? []);
const loadedCount = computed(() => loadedRows.value.length);
const loadedLeads = computed(() =>
  loadedRows.value.reduce((sum, publication) => sum + publication.numberOfLeads, 0),
);
const inProgressCount = computed(
  () =>
    loadedRows.value.filter((publication) =>
      ["PAGE_PROCESSING", "LEAD_PROCESSING"].includes(publication.status),
    ).length,
);
const confirmedCount = computed(
  () =>
    loadedRows.value.filter((publication) => publication.status === "CONFIRMED")
      .length,
);

useIntersectionObserver(loadMoreRef, ([entry]) => {
  if (
    entry?.isIntersecting &&
    status.value === "CanLoadMore" &&
    !isLoading.value
  ) {
    void loadMore(batchSize);
  }
});

function formatDateTime(timestamp?: number) {
  if (!timestamp) return "-";

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(timestamp);
}

function formatDate(timestamp?: number) {
  if (!timestamp) return "-";

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
  }).format(timestamp);
}

function prettyStatus(statusValue: string) {
  return statusValue
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function statusClass(statusValue: string) {
  if (statusValue === "LEADS_FOUND") {
    return "border border-amber-200 bg-amber-100/90 text-amber-900";
  }

  if (statusValue === "CONFIRMED") {
    return "border border-emerald-200 bg-emerald-100/90 text-emerald-900";
  }

  if (statusValue.endsWith("ERROR")) {
    return "border border-red-200 bg-red-100/90 text-red-900";
  }

  if (statusValue === "NO_LEADS_FOUND") {
    return "border border-zinc-300 bg-zinc-100 text-zinc-800";
  }

  return "border border-blue-200 bg-blue-100/90 text-blue-900";
}

function openFilePicker() {
  fileInputRef.value?.click();
}

async function onInputChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = input.files;
  if (!files) return;
  selectedFileCount.value = files.length;

  for await (const file of files) {
    if (file.type !== "application/pdf") continue;

    try {
      const id = await upload(file);

      await createPublication({
        fileStorageId: id as Id<"_storage">,
        fileName: file.name,
      });
    } catch {
      console.error(error);
    }
  }

  input.value = "";
  selectedFileCount.value = 0;
}
</script>

<template>
  <main class="min-h-dvh bg-[radial-gradient(circle_at_10%_12%,rgba(251,191,36,0.10),transparent_40%),radial-gradient(circle_at_92%_88%,rgba(59,130,246,0.08),transparent_42%)] px-4 py-6 sm:px-6 lg:px-8">
    <div class="mx-auto w-full max-w-[1400px] space-y-5">
      <header class="rounded-2xl border border-border/70 bg-card/90 p-5 shadow-sm backdrop-blur">
        <div>
          <h1 class="text-2xl font-semibold tracking-tight sm:text-3xl">Publications</h1>
          <p class="text-muted-foreground mt-1 text-sm">
            Review uploaded publications and processing progress.
          </p>
        </div>

        <div class="mt-4 rounded-xl border border-border/70 bg-muted/30 p-3">
          <input
            ref="fileInputRef"
            type="file"
            accept="application/pdf"
            :disabled="pending"
            multiple
            class="hidden"
            @change="onInputChange"
          >
          <div class="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              :disabled="pending"
              class="h-10 rounded-lg px-4"
              @click="openFilePicker"
            >
              {{ pending ? "Uploading..." : "Upload PDFs" }}
            </Button>
            <p class="text-sm">
              <span v-if="pending" class="font-medium text-foreground">Processing selected files...</span>
              <span v-else-if="selectedFileCount > 0" class="font-medium text-foreground">{{ selectedFileCount }} file(s) selected</span>
              <span v-else class="text-muted-foreground">Choose one or more PDF files to import.</span>
            </p>
          </div>
          <p class="text-muted-foreground mt-2 text-xs">
            PDF only, max 250MB per file.
          </p>
          <p
            v-if="error"
            class="mt-2 text-xs font-medium text-red-700"
          >
            Upload failed. Please try again.
          </p>
        </div>
      </header>

      <section class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <article class="rounded-xl border border-border/70 bg-card/90 p-4 shadow-sm">
          <p class="text-muted-foreground text-xs uppercase tracking-[0.1em]">Loaded Publications</p>
          <p class="mt-2 text-2xl font-semibold">{{ loadedCount }}</p>
        </article>
        <article class="rounded-xl border border-border/70 bg-card/90 p-4 shadow-sm">
          <p class="text-muted-foreground text-xs uppercase tracking-[0.1em]">Detected AI Leads</p>
          <p class="mt-2 text-2xl font-semibold">{{ loadedLeads }}</p>
        </article>
        <article class="rounded-xl border border-border/70 bg-card/90 p-4 shadow-sm">
          <p class="text-muted-foreground text-xs uppercase tracking-[0.1em]">In Progress</p>
          <p class="mt-2 text-2xl font-semibold">{{ inProgressCount }}</p>
        </article>
        <article class="rounded-xl border border-border/70 bg-card/90 p-4 shadow-sm">
          <p class="text-muted-foreground text-xs uppercase tracking-[0.1em]">Confirmed</p>
          <p class="mt-2 text-2xl font-semibold">{{ confirmedCount }}</p>
        </article>
      </section>

      <section class="overflow-hidden rounded-2xl border border-border/70 bg-card/90 shadow-sm">
        <Table>
          <TableHeader class="sticky top-0 z-10">
            <TableRow class="bg-muted/70 backdrop-blur hover:bg-muted/70">
              <TableHead class="font-semibold">Publication</TableHead>
              <TableHead class="font-semibold">File Name</TableHead>
              <TableHead class="font-semibold">Source</TableHead>
              <TableHead class="font-semibold">Status</TableHead>
              <TableHead class="text-right font-semibold">AI Leads</TableHead>
              <TableHead class="text-right font-semibold">Pages</TableHead>
              <TableHead class="font-semibold">Confirmed Date</TableHead>
              <TableHead class="font-semibold">Uploaded</TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            <template v-if="loadedRows.length > 0">
              <TableRow
                v-for="publication in loadedRows"
                :key="publication._id"
                class="odd:bg-background even:bg-muted/20"
              >
                <TableCell class="max-w-[320px] truncate font-semibold text-foreground">
                  {{ publication.metadata?.publicationName ?? publication.name }}
                </TableCell>
                <TableCell class="max-w-[260px] truncate text-muted-foreground">{{ publication.name }}</TableCell>
                <TableCell>
                  <Badge variant="outline" class="rounded-md px-2 py-0.5 text-[11px] tracking-wide">
                    {{ publication.sourceType }}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge
                    variant="secondary"
                    :class="`rounded-md px-2 py-0.5 text-[11px] tracking-wide ${statusClass(publication.status)}`"
                  >
                    {{ prettyStatus(publication.status) }}
                  </Badge>
                </TableCell>
                <TableCell class="text-right font-semibold tabular-nums">{{ publication.numberOfLeads }}</TableCell>
                <TableCell class="text-right">{{ publication.pageCount }}</TableCell>
                <TableCell>{{ formatDate(publication.confirmDate) }}</TableCell>
                <TableCell class="text-muted-foreground">{{ formatDateTime(publication.createdAt) }}</TableCell>
              </TableRow>
            </template>

            <TableEmpty
              v-else-if="status !== 'LoadingFirstPage' && !isLoading"
              :colspan="8"
            >
              No publications found.
            </TableEmpty>

            <TableRow v-else>
              <TableCell :colspan="8" class="py-10 text-center text-sm text-muted-foreground">
                Loading publications...
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </section>

      <section class="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border/70 bg-card/80 px-4 py-3 text-sm shadow-sm">
        <div class="text-muted-foreground">
          {{ loadedCount }} publications loaded
          <span v-if="status === 'CanLoadMore'">. Scroll to load more.</span>
          <span v-else-if="status === 'Exhausted'">. End of list.</span>
        </div>

        <div
          ref="loadMoreRef"
          class="text-muted-foreground flex h-10 min-w-44 items-center justify-end"
        >
          <span v-if="isLoading">Loading more...</span>
        </div>
      </section>
    </div>
  </main>
</template>
