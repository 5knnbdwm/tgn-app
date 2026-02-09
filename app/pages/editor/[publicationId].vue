<script setup lang="ts">
import { api } from "~~/convex/_generated/api";
import type { Id } from "~~/convex/_generated/dataModel";
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  RefreshCw,
} from "lucide-vue-next";

definePageMeta({ middleware: "auth", layout: "dashboard" });

const route = useRoute();
const router = useRouter();

const publicationId = computed(
  () => route.params.publicationId as Id<"publications">,
);
const currentPage = computed(() => {
  const raw = Number(route.query.page ?? 1);
  if (!Number.isFinite(raw) || raw < 1) return 1;
  return Math.floor(raw);
});

const sidebarData = useConvexQuery(
  api.publications.publicationQueries.getEditorSidebar,
  computed(() => ({
    publicationId: publicationId.value,
  })),
);
const pageData = useConvexQuery(
  api.publications.publicationQueries.getPage,
  computed(() => ({
    publicationId: publicationId.value,
    pageNumber: currentPage.value,
  })),
);
const { mutate: retryPublicationProcessing } = useConvexMutation(
  api.publications.publicationMutations.retryPublicationProcessing,
);

const selectedLeadId = ref<string | null>(null);
const expandedPageNumber = ref<number | null>(null);
const retryingProcessing = ref(false);
const sidebar = computed(() => sidebarData.data.value);
const currentPageData = computed(() => pageData.data.value);
const publicationStatus = computed(() => sidebar.value?.publication.status);
const maxPage = computed(() => sidebar.value?.publication.pageCount ?? 1);
const pageLeads = computed(() => currentPageData.value?.leads ?? []);
const pagesWithLeads = computed(() => sidebar.value?.pagesWithLeads ?? []);
const pageNumbersWithLeads = computed(() =>
  pagesWithLeads.value.map((entry) => entry.pageNumber).sort((a, b) => a - b),
);
const previousLeadPage = computed(() => {
  const current = currentPage.value;
  const candidates = pageNumbersWithLeads.value.filter(
    (pageNumber) => pageNumber < current,
  );
  return candidates.length > 0 ? candidates[candidates.length - 1] : null;
});
const nextLeadPage = computed(() => {
  const current = currentPage.value;
  const candidates = pageNumbersWithLeads.value.filter(
    (pageNumber) => pageNumber > current,
  );
  return candidates.length > 0 ? candidates[0] : null;
});

watch(
  [maxPage, currentPage],
  ([maxValue, currentValue]) => {
    if (!sidebar.value?.publication) return;
    if (currentValue > maxValue && maxValue > 0) {
      void setPage(maxValue);
    }
  },
  { immediate: true },
);

watch(
  currentPage,
  (pageNumber) => {
    expandedPageNumber.value = pageNumber;
  },
  { immediate: true },
);

function buildQuery(pageNumber: number) {
  return {
    ...route.query,
    page: String(pageNumber),
  };
}

async function setPage(pageNumber: number) {
  if (pageNumber < 1 || pageNumber > maxPage.value) return;
  if (pageNumber === currentPage.value) return;
  await router.replace({ query: buildQuery(pageNumber) });
}

function formatLeadCategory(value: string) {
  return value === "AI_LEAD" ? "AI Lead" : "Missed Lead";
}

function prettyStatus(statusValue: string) {
  return statusValue
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function statusClass(statusValue: string) {
  if (statusValue.endsWith("ERROR")) {
    return "border-red-200 bg-red-100/90 text-red-900";
  }
  if (statusValue === "LEADS_FOUND" || statusValue === "CONFIRMED") {
    return "border-emerald-200 bg-emerald-100/90 text-emerald-900";
  }
  if (statusValue === "NO_LEADS_FOUND") {
    return "border-zinc-300 bg-zinc-100 text-zinc-800";
  }
  return "border-blue-200 bg-blue-100/90 text-blue-900";
}

const canRetryProcessing = computed(
  () =>
    publicationStatus.value === "PROCESS_PAGE_ERROR" ||
    publicationStatus.value === "PROCESS_LEAD_ERROR",
);

async function retryProcessing() {
  if (!canRetryProcessing.value || retryingProcessing.value) return;
  retryingProcessing.value = true;
  try {
    await retryPublicationProcessing({ publicationId: publicationId.value });
  } finally {
    retryingProcessing.value = false;
  }
}

function confidenceLabel(score: number) {
  return `${Math.round(score)}% confidence`;
}

function togglePageExpansion(pageNumber: number) {
  expandedPageNumber.value =
    expandedPageNumber.value === pageNumber ? null : pageNumber;
}

function overlayStyle(bbox: number[]) {
  const page = currentPageData.value?.page;
  if (!page || bbox.length !== 4) return {};

  const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = bbox;
  const left = (x1 / page.pageWidth) * 100;
  const top = (y1 / page.pageHeight) * 100;
  const width = ((x2 - x1) / page.pageWidth) * 100;
  const height = ((y2 - y1) / page.pageHeight) * 100;

  return {
    left: `${Math.max(0, left)}%`,
    top: `${Math.max(0, top)}%`,
    width: `${Math.max(0, width)}%`,
    height: `${Math.max(0, height)}%`,
  };
}
</script>

<template>
  <main
    class="h-[calc(100dvh-3.5rem)] overflow-hidden bg-[radial-gradient(circle_at_12%_12%,rgba(56,189,248,0.08),transparent_45%),radial-gradient(circle_at_88%_82%,rgba(249,115,22,0.08),transparent_42%)] px-4 py-5 sm:px-6 lg:px-8"
  >
    <div
      class="mx-auto flex h-full w-full max-w-[1500px] flex-col gap-4 overflow-hidden"
    >
      <header
        class="rounded-2xl border border-border/70 bg-card/90 p-4 shadow-sm"
      >
        <div
          class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"
        >
          <div>
            <p
              class="text-muted-foreground text-xs uppercase tracking-[0.14em]"
            >
              <NuxtLink to="/" class="text-primary hover:underline"
                >Publications</NuxtLink
              >
              | Editor
            </p>
            <div class="mt-1 flex flex-wrap items-center gap-2">
              <h1 class="text-xl font-semibold tracking-tight sm:text-2xl">
                {{
                  sidebar?.publication.metadata?.publicationName ??
                  sidebar?.publication.name ??
                  "Publication"
                }}
              </h1>
              <span
                v-if="publicationStatus"
                :class="`inline-flex rounded-md border px-2 py-0.5 text-[11px] tracking-wide ${statusClass(publicationStatus)}`"
              >
                {{ prettyStatus(publicationStatus) }}
              </span>
              <Button
                v-if="canRetryProcessing"
                size="icon-xs"
                variant="outline"
                class="size-6"
                :disabled="retryingProcessing"
                aria-label="Retry processing"
                @click="retryProcessing"
              >
                <RefreshCw
                  class="size-3.5"
                  :class="{ 'animate-spin': retryingProcessing }"
                />
              </Button>
            </div>
            <p class="text-muted-foreground mt-1 text-sm">
              Page {{ currentPage }} / {{ maxPage }}
            </p>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <ButtonGroup>
              <Button
                variant="outline"
                :disabled="currentPage <= 1"
                @click="setPage(currentPage - 1)"
              >
                <ChevronLeft class="size-4" />
                Previous Page
              </Button>
              <Button
                variant="outline"
                :disabled="currentPage >= maxPage"
                @click="setPage(currentPage + 1)"
              >
                Next Page
                <ChevronRight class="size-4" />
              </Button>
            </ButtonGroup>
            <ButtonGroup>
              <Button
                variant="outline"
                :disabled="!previousLeadPage"
                @click="previousLeadPage && setPage(previousLeadPage)"
              >
                <ChevronLeft class="size-4" />
                Previous Lead
              </Button>
              <Button
                variant="outline"
                :disabled="!nextLeadPage"
                @click="nextLeadPage && setPage(nextLeadPage)"
              >
                Next Lead
                <ChevronRight class="size-4" />
              </Button>
            </ButtonGroup>
          </div>
        </div>
      </header>

      <section
        class="min-h-0 flex-1 grid gap-4 overflow-hidden xl:grid-cols-[minmax(0,1fr)_430px]"
      >
        <article
          class="min-h-0 rounded-2xl border border-border/70 bg-card/90 p-3 shadow-sm"
        >
          <div
            class="h-full overflow-auto rounded-xl border border-border/70 bg-muted/20 p-3"
          >
            <div class="mx-auto max-w-[900px]">
              <div
                v-if="!currentPageData?.pageImageUrl"
                class="text-muted-foreground flex min-h-[560px] items-center justify-center rounded-lg border border-dashed border-border text-sm"
              >
                Page image unavailable.
              </div>

              <div
                v-else
                class="relative overflow-hidden rounded-lg border border-border bg-white shadow-inner"
              >
                <img
                  :src="currentPageData.pageImageUrl"
                  :alt="`Publication page ${currentPage}`"
                  class="h-auto w-full object-contain select-none"
                />
                <div class="pointer-events-none absolute inset-0">
                  <div
                    v-for="lead in pageLeads"
                    :key="lead._id"
                    class="absolute border-2 transition-colors"
                    :class="
                      lead._id === selectedLeadId
                        ? 'border-emerald-500 bg-emerald-300/20'
                        : 'border-sky-500 bg-sky-300/10'
                    "
                    :style="overlayStyle(lead.bbox)"
                  />
                </div>
              </div>
            </div>
          </div>
        </article>

        <aside
          class="min-h-0 rounded-2xl border border-border/70 bg-card/90 p-3 shadow-sm"
        >
          <div class="h-full min-h-0 space-y-3 overflow-y-auto pr-1">
            <div
              v-if="pagesWithLeads.length === 0"
              class="text-muted-foreground rounded-lg border border-dashed border-border px-3 py-8 text-center text-sm"
            >
              No leads found for this publication yet.
            </div>

            <section
              v-for="pageEntry in pagesWithLeads"
              :key="pageEntry.pageNumber"
              class="rounded-xl border border-border/70 bg-background/80 p-3 space-y-2"
            >
              <div class="flex items-center gap-2">
                <Button
                  size="icon-xs"
                  variant="outline"
                  @click="togglePageExpansion(pageEntry.pageNumber)"
                >
                  <ChevronDown
                    v-if="expandedPageNumber !== pageEntry.pageNumber"
                    class="size-4"
                  />
                  <ChevronUp v-else class="size-4" />
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  @click="setPage(pageEntry.pageNumber)"
                >
                  Page {{ pageEntry.pageNumber }}
                </Button>

                <div class="text-muted-foreground text-xs">
                  {{ pageEntry.leads.length }} leads
                </div>
              </div>

              <div
                v-if="expandedPageNumber === pageEntry.pageNumber"
                class="space-y-2"
              >
                <article
                  v-for="lead in pageEntry.leads"
                  :key="lead._id"
                  class="rounded-lg border border-border/70 bg-card p-2"
                  @mouseenter="selectedLeadId = lead._id"
                  @mouseleave="selectedLeadId = null"
                >
                  <div class="flex items-center justify-between gap-2">
                    <p class="text-sm font-semibold">
                      {{ formatLeadCategory(lead.category) }}
                    </p>
                    <p class="text-muted-foreground text-xs">
                      {{ confidenceLabel(lead.confidenceScore) }}
                    </p>
                  </div>

                  <p class="mt-1 text-sm">
                    {{
                      lead.enrichment?.articleHeader ||
                      "No article header extracted."
                    }}
                  </p>

                  <p class="text-muted-foreground mt-1 text-xs">
                    Enrichment: {{ lead.enrichment?.status || "PENDING" }}
                  </p>

                  <div class="mt-2 space-y-1 text-xs">
                    <p>
                      <span class="text-muted-foreground">Persons:</span>
                      {{
                        lead.enrichment?.personNames?.length
                          ? lead.enrichment.personNames.join(", ")
                          : "-"
                      }}
                    </p>
                    <p>
                      <span class="text-muted-foreground">Companies:</span>
                      {{
                        lead.enrichment?.companyNames?.length
                          ? lead.enrichment.companyNames.join(", ")
                          : "-"
                      }}
                    </p>
                  </div>
                </article>
              </div>
            </section>
          </div>
        </aside>
      </section>
    </div>
  </main>
</template>
