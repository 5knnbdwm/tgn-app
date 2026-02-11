<script setup lang="ts">
import { api } from "~~/convex/_generated/api";
import type { Id } from "~~/convex/_generated/dataModel";
import { MoreHorizontal } from "lucide-vue-next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

const { mutate: generatePublicationUploadUrl } = useConvexMutation(
  api.files.generatePublicationUploadUrl,
);
const { mutate: syncMetadata } = useConvexMutation(
  api.files.syncMetadata,
);
const { mutate: createPublication } = useConvexMutation(
  api.publications.publicationMutations.createPublicationUpload,
);
const { mutate: retryPublicationProcessing } = useConvexMutation(
  api.publications.publicationMutations.retryPublicationProcessing,
);
const { mutate: deletePublicationMutation } = useConvexMutation(
  api.publications.publicationMutations.deletePublication,
);
const convex = useConvex();

const fileInputRef = ref<HTMLInputElement | null>(null);
const selectedFileCount = ref(0);
const pending = ref(false);
const uploadError = ref<string | null>(null);
const retryingPublicationId = ref<Id<"publications"> | null>(null);
const downloadingPublicationId = ref<Id<"publications"> | null>(null);
const deletingPublicationId = ref<Id<"publications"> | null>(null);
const deleteDialogOpen = ref(false);
const publicationPendingDelete = ref<{
  _id: Id<"publications">;
  name: string;
} | null>(null);
const currentPage = ref(1);
const pageSize = 20;
const loadedRows = computed(() => publications.value ?? []);
const loadedCount = computed(() => loadedRows.value.length);
const totalLoadedPages = computed(() =>
  Math.max(1, Math.ceil(loadedRows.value.length / pageSize)),
);
const pagedRows = computed(() => {
  const start = (currentPage.value - 1) * pageSize;
  return loadedRows.value.slice(start, start + pageSize);
});
const canGoPrevious = computed(() => currentPage.value > 1);
const canGoNext = computed(
  () =>
    currentPage.value < totalLoadedPages.value ||
    status.value === "CanLoadMore",
);
const loadedLeads = computed(() =>
  loadedRows.value.reduce(
    (sum, publication) => sum + publication.numberOfLeads,
    0,
  ),
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

watch(totalLoadedPages, (pages) => {
  if (currentPage.value > pages) {
    currentPage.value = pages;
  }
});

watch(deleteDialogOpen, (isOpen) => {
  if (!isOpen && !deletingPublicationId.value) {
    publicationPendingDelete.value = null;
  }
});

async function goToPage(page: number) {
  if (page < 1) return;

  while (
    page > totalLoadedPages.value &&
    status.value === "CanLoadMore" &&
    !isLoading.value
  ) {
    await loadMore(pageSize);
  }

  currentPage.value = Math.min(page, totalLoadedPages.value);
}

async function nextPage() {
  if (!canGoNext.value) return;
  await goToPage(currentPage.value + 1);
}

async function previousPage() {
  if (!canGoPrevious.value) return;
  await goToPage(currentPage.value - 1);
}

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

function canRetryPublication(statusValue: string) {
  return ["PROCESS_PAGE_ERROR", "PROCESS_LEAD_ERROR"].includes(statusValue);
}

async function retryPublication(publicationId: Id<"publications">) {
  if (retryingPublicationId.value) return;
  retryingPublicationId.value = publicationId;
  try {
    await retryPublicationProcessing({ publicationId });
  } finally {
    retryingPublicationId.value = null;
  }
}

async function downloadPublication(publication: {
  _id: Id<"publications">;
  name: string;
  publicationFileKey: string;
}) {
  if (!convex || downloadingPublicationId.value) return;

  downloadingPublicationId.value = publication._id;

  try {
    const fileUrl = await convex.query(api.files.getUrl, {
      key: publication.publicationFileKey,
      expiresIn: 60 * 60,
    });
    if (!fileUrl) return;

    const response = await fetch(fileUrl);
    if (!response.ok) {
      throw new Error(`Download failed with status ${response.status}`);
    }

    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const fileName = publication.name.toLowerCase().endsWith(".pdf")
      ? publication.name
      : `${publication.name}.pdf`;

    link.href = objectUrl;
    link.download = fileName;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
  } catch (error) {
    console.error("Failed to download original publication file", error);
  } finally {
    downloadingPublicationId.value = null;
  }
}

function requestDeletePublication(publication: {
  _id: Id<"publications">;
  name: string;
}) {
  if (deletingPublicationId.value) return;
  publicationPendingDelete.value = publication;
  deleteDialogOpen.value = true;
}

async function confirmDeletePublication() {
  if (!publicationPendingDelete.value || deletingPublicationId.value) return;

  const publication = publicationPendingDelete.value;
  deletingPublicationId.value = publication._id;
  try {
    await deletePublicationMutation({ publicationId: publication._id });
    deleteDialogOpen.value = false;
    publicationPendingDelete.value = null;
  } catch (error) {
    console.error("Failed to delete publication", error);
  } finally {
    deletingPublicationId.value = null;
  }
}

function openFilePicker() {
  fileInputRef.value?.click();
}

async function onInputChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = input.files;
  if (!files) return;
  selectedFileCount.value = files.length;
  pending.value = true;
  uploadError.value = null;

  for await (const file of files) {
    if (file.type !== "application/pdf") continue;
    if (file.size > 250 * 1024 * 1024) {
      uploadError.value = "Upload failed. Please try again.";
      continue;
    }

    try {
      const { key, url } = await generatePublicationUploadUrl({
        fileName: file.name,
      });
      const uploadResponse = await fetch(url, {
        method: "PUT",
        headers: {
          "content-type": file.type || "application/pdf",
        },
        body: file,
      });
      if (!uploadResponse.ok) {
        throw new Error(`R2 upload failed with status ${uploadResponse.status}`);
      }
      await syncMetadata({ key });

      await createPublication({
        fileKey: key,
        fileName: file.name,
        fileMimeType: file.type || "application/pdf",
        fileSize: file.size,
      });
    } catch {
      uploadError.value = "Upload failed. Please try again.";
    }
  }

  input.value = "";
  selectedFileCount.value = 0;
  pending.value = false;
}
</script>

<template>
  <main
    class="min-h-dvh bg-[radial-gradient(circle_at_10%_12%,rgba(251,191,36,0.10),transparent_40%),radial-gradient(circle_at_92%_88%,rgba(59,130,246,0.08),transparent_42%)] px-4 py-6 sm:px-6 lg:px-8"
  >
    <div class="mx-auto container space-y-5">
      <header
        class="rounded-2xl border border-border/70 bg-card/90 p-5 shadow-sm backdrop-blur"
      >
        <div>
          <h1 class="text-2xl font-semibold tracking-tight sm:text-3xl">
            Publications
          </h1>
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
          />
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
              <span v-if="pending" class="font-medium text-foreground"
                >Processing selected files...</span
              >
              <span
                v-else-if="selectedFileCount > 0"
                class="font-medium text-foreground"
                >{{ selectedFileCount }} file(s) selected</span
              >
              <span v-else class="text-muted-foreground"
                >Choose one or more PDF files to import.</span
              >
            </p>
          </div>
          <p class="text-muted-foreground mt-2 text-xs">
            PDF only, max 250MB per file.
          </p>
          <p v-if="uploadError" class="mt-2 text-xs font-medium text-red-700">
            {{ uploadError }}
          </p>
        </div>
      </header>

      <section class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <article
          class="rounded-xl border border-border/70 bg-card/90 p-4 shadow-sm"
        >
          <p class="text-muted-foreground text-xs uppercase tracking-[0.1em]">
            Loaded Publications
          </p>
          <p class="mt-2 text-2xl font-semibold">{{ loadedCount }}</p>
        </article>
        <article
          class="rounded-xl border border-border/70 bg-card/90 p-4 shadow-sm"
        >
          <p class="text-muted-foreground text-xs uppercase tracking-[0.1em]">
            Detected AI Leads
          </p>
          <p class="mt-2 text-2xl font-semibold">{{ loadedLeads }}</p>
        </article>
        <article
          class="rounded-xl border border-border/70 bg-card/90 p-4 shadow-sm"
        >
          <p class="text-muted-foreground text-xs uppercase tracking-[0.1em]">
            In Progress
          </p>
          <p class="mt-2 text-2xl font-semibold">{{ inProgressCount }}</p>
        </article>
        <article
          class="rounded-xl border border-border/70 bg-card/90 p-4 shadow-sm"
        >
          <p class="text-muted-foreground text-xs uppercase tracking-[0.1em]">
            Confirmed
          </p>
          <p class="mt-2 text-2xl font-semibold">{{ confirmedCount }}</p>
        </article>
      </section>

      <section
        class="overflow-hidden rounded-2xl border border-border/70 bg-card/90 shadow-sm"
      >
        <Table>
          <TableHeader class="sticky top-0 z-10">
            <TableRow class="bg-muted/70 backdrop-blur hover:bg-muted/70">
              <TableHead class="font-semibold">Publication</TableHead>
              <TableHead class="font-semibold">File Name</TableHead>
              <TableHead class="font-semibold">Editor</TableHead>
              <TableHead class="font-semibold">Source</TableHead>
              <TableHead class="font-semibold">Status</TableHead>
              <TableHead class="text-right font-semibold">AI Leads</TableHead>
              <TableHead class="text-right font-semibold">Pages</TableHead>
              <TableHead class="font-semibold">Confirmed Date</TableHead>
              <TableHead class="font-semibold">Uploaded</TableHead>
              <TableHead class="w-[50px] font-semibold">Actions</TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            <template v-if="pagedRows.length > 0">
              <TableRow
                v-for="publication in pagedRows"
                :key="publication._id"
                class="odd:bg-background even:bg-muted/20"
              >
                <TableCell
                  class="max-w-[320px] truncate font-semibold text-foreground"
                >
                  {{
                    publication.metadata?.publicationName ?? publication.name
                  }}
                </TableCell>
                <TableCell
                  class="max-w-[260px] truncate text-muted-foreground"
                  >{{ publication.name }}</TableCell
                >
                <TableCell>
                  <NuxtLink
                    :to="`/editor/${publication._id}`"
                    class="inline-flex h-8 items-center rounded-md border border-border px-2.5 text-xs font-medium hover:bg-muted"
                  >
                    Open Editor
                  </NuxtLink>
                </TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    class="rounded-md px-2 py-0.5 text-[11px] tracking-wide"
                  >
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
                <TableCell class="text-right font-semibold tabular-nums">{{
                  publication.numberOfLeads
                }}</TableCell>
                <TableCell class="text-right">{{
                  publication.pageCount
                }}</TableCell>
                <TableCell>{{ formatDate(publication.confirmDate) }}</TableCell>
                <TableCell class="text-muted-foreground">{{
                  formatDateTime(publication.createdAt)
                }}</TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger as-child>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        class="size-8"
                        :aria-label="`Actions for ${publication.name}`"
                      >
                        <MoreHorizontal class="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" class="w-52">
                      <DropdownMenuLabel>Actions</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        :disabled="downloadingPublicationId === publication._id"
                        @select="() => void downloadPublication(publication)"
                      >
                        {{
                          downloadingPublicationId === publication._id
                            ? "Downloading..."
                            : "Download original PDF"
                        }}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        :disabled="
                          !canRetryPublication(publication.status) ||
                          retryingPublicationId === publication._id
                        "
                        @select="() => void retryPublication(publication._id)"
                      >
                        {{
                          retryingPublicationId === publication._id
                            ? "Retrying..."
                            : "Retry processing"
                        }}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        :disabled="deletingPublicationId === publication._id"
                        class="text-red-600 focus:text-red-700"
                        @select="() => requestDeletePublication(publication)"
                      >
                        {{
                          deletingPublicationId === publication._id
                            ? "Deleting..."
                            : "Delete publication"
                        }}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            </template>

            <TableEmpty
              v-else-if="status !== 'LoadingFirstPage' && !isLoading"
              :colspan="10"
            >
              No publications found.
            </TableEmpty>

            <TableRow v-else>
              <TableCell
                :colspan="10"
                class="py-10 text-center text-sm text-muted-foreground"
              >
                Loading publications...
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </section>

      <section
        class="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border/70 bg-card/80 px-4 py-3 text-sm shadow-sm"
      >
        <div class="text-muted-foreground">
          Page {{ currentPage }} of {{ totalLoadedPages }}
          <span v-if="status === 'CanLoadMore'">. More pages available.</span>
          <span v-else-if="status === 'Exhausted'">. End of list.</span>
        </div>

        <div class="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            class="h-9 px-3"
            :disabled="!canGoPrevious || isLoading"
            @click="previousPage"
          >
            Previous
          </Button>

          <Button
            v-for="page in totalLoadedPages"
            :key="page"
            type="button"
            variant="outline"
            class="h-9 min-w-9 px-3"
            :class="{
              'bg-foreground text-background hover:bg-foreground hover:text-background':
                page === currentPage,
            }"
            :disabled="isLoading"
            @click="goToPage(page)"
          >
            {{ page }}
          </Button>

          <Button
            type="button"
            variant="outline"
            class="h-9 px-3"
            :disabled="!canGoNext || isLoading"
            @click="nextPage"
          >
            {{
              status === "CanLoadMore" && currentPage === totalLoadedPages
                ? "Load Next Page"
                : "Next"
            }}
          </Button>

          <span v-if="isLoading" class="text-muted-foreground pl-1 text-xs">
            Loading...
          </span>
        </div>
      </section>
    </div>

    <Dialog v-model:open="deleteDialogOpen">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete publication?</DialogTitle>
          <DialogDescription>
            This action cannot be undone. This will permanently delete
            <span class="font-medium text-foreground">
              {{ publicationPendingDelete?.name ?? "this publication" }}
            </span>
            and all associated data.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            :disabled="Boolean(deletingPublicationId)"
            @click="deleteDialogOpen = false"
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            :disabled="!publicationPendingDelete || Boolean(deletingPublicationId)"
            @click="() => void confirmDeletePublication()"
          >
            {{ deletingPublicationId ? "Deleting..." : "Delete publication" }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </main>
</template>
