<script setup lang="ts">
import { api } from "~~/convex/_generated/api";
import type { Id } from "~~/convex/_generated/dataModel";
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  ZoomIn,
  ZoomOut,
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
const leadSidebarScrollContainer = ref<HTMLElement | null>(null);
const leadPageSectionRefs = ref<Record<number, HTMLElement | null>>({});
const MIN_ZOOM = 100;
const MAX_ZOOM = 300;
const ZOOM_STEP = 25;
const zoomPercent = ref(100);
const sidebar = computed(() => sidebarData.data.value);
const currentPageData = computed(() => pageData.data.value);
const publicationStatus = computed(() => sidebar.value?.publication.status);
const maxPage = computed(() => sidebar.value?.publication.pageCount ?? 1);
const pageLeads = computed(() => currentPageData.value?.leads ?? []);
const pagesWithLeads = computed(() => sidebar.value?.pagesWithLeads ?? []);
const pageNumbersWithLeads = computed(() =>
  pagesWithLeads.value.map((entry) => entry.pageNumber).sort((a, b) => a - b),
);
const previousPage = computed(() =>
  currentPage.value > 1 ? currentPage.value - 1 : null,
);
const nextPage = computed(() =>
  currentPage.value < maxPage.value ? currentPage.value + 1 : null,
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

type NameBox = {
  name: string;
  bbox: number[];
};

function bboxLabel(bbox?: number[] | null) {
  if (!bbox || bbox.length !== 4) return "-";
  const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = bbox;
  return `[${Math.round(x1)}, ${Math.round(y1)}, ${Math.round(x2)}, ${Math.round(y2)}]`;
}

function formatNamesWithBboxes(names?: string[], boxes?: NameBox[]) {
  if (!names?.length) return "-";
  return names
    .map((name) => {
      const bbox = boxes?.find((entry) => entry.name === name)?.bbox;
      return bbox ? `${name} ${bboxLabel(bbox)}` : name;
    })
    .join(", ");
}

function zoomIn() {
  zoomPercent.value = Math.min(MAX_ZOOM, zoomPercent.value + ZOOM_STEP);
}

function zoomOut() {
  zoomPercent.value = Math.max(MIN_ZOOM, zoomPercent.value - ZOOM_STEP);
}

function resetZoom() {
  zoomPercent.value = 100;
}

function togglePageExpansion(pageNumber: number) {
  expandedPageNumber.value =
    expandedPageNumber.value === pageNumber ? null : pageNumber;
}

function setLeadPageSectionRef(pageNumber: number, element: Element | null) {
  leadPageSectionRefs.value[pageNumber] = element as HTMLElement | null;
}

function scrollLeadPageIntoView(pageNumber: number) {
  const container = leadSidebarScrollContainer.value;
  const section = leadPageSectionRefs.value[pageNumber];
  if (!container || !section) return;

  const containerRect = container.getBoundingClientRect();
  const sectionRect = section.getBoundingClientRect();
  const isAbove = sectionRect.top < containerRect.top;
  const isBelow = sectionRect.bottom > containerRect.bottom;
  if (isAbove || isBelow) {
    section.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}

const selectedLead = computed(
  () => pageLeads.value.find((lead) => lead._id === selectedLeadId.value) ?? null,
);

const selectedLeadEnrichmentOverlays = computed(() => {
  const enrichment = selectedLead.value?.enrichment;
  if (!enrichment) return [];

  const overlays: Array<{
    key: string;
    kind: "header" | "person" | "company";
    label: string;
    bbox: number[];
  }> = [];

  if (enrichment.articleHeaderBbox?.length === 4) {
    overlays.push({
      key: "header",
      kind: "header",
      label: "Header",
      bbox: enrichment.articleHeaderBbox,
    });
  }

  (enrichment.personNameBoxes ?? []).forEach((entry: NameBox, index: number) => {
    if (entry.bbox?.length === 4) {
      overlays.push({
        key: `person-${entry.name}-${index}`,
        kind: "person",
        label: `Person: ${entry.name}`,
        bbox: entry.bbox,
      });
    }
  });

  (enrichment.companyNameBoxes ?? []).forEach(
    (entry: NameBox, index: number) => {
      if (entry.bbox?.length === 4) {
        overlays.push({
          key: `company-${entry.name}-${index}`,
          kind: "company",
          label: `Company: ${entry.name}`,
          bbox: entry.bbox,
        });
      }
    },
  );

  return overlays;
});

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

watch(
  currentPage,
  async (pageNumber) => {
    if (!pagesWithLeads.value.some((entry) => entry.pageNumber === pageNumber)) {
      return;
    }
    await nextTick();
    scrollLeadPageIntoView(pageNumber);
  },
  { flush: "post" },
);
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

          <div class="grid w-full gap-2 sm:w-auto sm:grid-cols-2">
            <section
              class="rounded-xl border border-sky-200/70 bg-gradient-to-r from-sky-50/70 to-transparent p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]"
            >
              <p
                class="px-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-sky-700"
              >
                Page Navigation
              </p>
              <ButtonGroup class="mt-1 w-full">
                <Button
                  variant="outline"
                  class="h-8 min-w-[132px] justify-between border-sky-200/80 bg-white/90 px-2.5 text-sky-950 hover:bg-sky-50"
                  :disabled="!previousPage"
                  @click="previousPage && setPage(previousPage)"
                >
                  <span class="inline-flex items-center gap-1.5 text-xs">
                    <ChevronLeft class="size-3.5" />
                    Prev Page
                  </span>
                  <span class="rounded-sm bg-sky-100 px-1.5 text-[11px]">
                    {{ previousPage ?? "-" }}
                  </span>
                </Button>
                <Button
                  variant="outline"
                  class="h-8 min-w-[132px] justify-between border-sky-200/80 bg-white/90 px-2.5 text-sky-950 hover:bg-sky-50"
                  :disabled="!nextPage"
                  @click="nextPage && setPage(nextPage)"
                >
                  <span class="inline-flex items-center gap-1.5 text-xs">
                    Next Page
                    <ChevronRight class="size-3.5" />
                  </span>
                  <span class="rounded-sm bg-sky-100 px-1.5 text-[11px]">
                    {{ nextPage ?? "-" }}
                  </span>
                </Button>
              </ButtonGroup>
            </section>

            <section
              class="rounded-xl border border-emerald-200/70 bg-gradient-to-r from-emerald-50/70 to-transparent p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]"
            >
              <p
                class="px-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-emerald-700"
              >
                Lead Navigation
              </p>
              <ButtonGroup class="mt-1 w-full">
                <Button
                  variant="outline"
                  class="h-8 min-w-[132px] justify-between border-emerald-200/80 bg-white/90 px-2.5 text-emerald-950 hover:bg-emerald-50"
                  :disabled="!previousLeadPage"
                  @click="previousLeadPage && setPage(previousLeadPage)"
                >
                  <span class="inline-flex items-center gap-1.5 text-xs">
                    <ChevronLeft class="size-3.5" />
                    Prev Lead
                  </span>
                  <span class="rounded-sm bg-emerald-100 px-1.5 text-[11px]">
                    {{ previousLeadPage ?? "-" }}
                  </span>
                </Button>
                <Button
                  variant="outline"
                  class="h-8 min-w-[132px] justify-between border-emerald-200/80 bg-white/90 px-2.5 text-emerald-950 hover:bg-emerald-50"
                  :disabled="!nextLeadPage"
                  @click="nextLeadPage && setPage(nextLeadPage)"
                >
                  <span class="inline-flex items-center gap-1.5 text-xs">
                    Next Lead
                    <ChevronRight class="size-3.5" />
                  </span>
                  <span class="rounded-sm bg-emerald-100 px-1.5 text-[11px]">
                    {{ nextLeadPage ?? "-" }}
                  </span>
                </Button>
              </ButtonGroup>
            </section>
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
              <div class="mb-3 flex items-center justify-end gap-2">
                <Button
                  size="icon-xs"
                  variant="outline"
                  :disabled="zoomPercent <= MIN_ZOOM"
                  aria-label="Zoom out"
                  @click="zoomOut"
                >
                  <ZoomOut class="size-4" />
                </Button>
                <Button size="xs" variant="outline" @click="resetZoom">
                  {{ zoomPercent }}%
                </Button>
                <Button
                  size="icon-xs"
                  variant="outline"
                  :disabled="zoomPercent >= MAX_ZOOM"
                  aria-label="Zoom in"
                  @click="zoomIn"
                >
                  <ZoomIn class="size-4" />
                </Button>
              </div>

              <div
                v-if="!currentPageData?.pageImageUrl"
                class="text-muted-foreground flex min-h-[560px] items-center justify-center rounded-lg border border-dashed border-border text-sm"
              >
                Page image unavailable.
              </div>

              <div
                v-else
                class="overflow-auto rounded-lg border border-border bg-white shadow-inner"
              >
                <div class="relative min-w-full" :style="{ width: `${zoomPercent}%` }">
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
                    <div
                      v-for="overlay in selectedLeadEnrichmentOverlays"
                      :key="overlay.key"
                      class="absolute border-2 border-dashed transition-colors"
                      :class="
                        overlay.kind === 'header'
                          ? 'border-amber-500 bg-amber-200/20'
                          : overlay.kind === 'person'
                            ? 'border-fuchsia-500 bg-fuchsia-200/20'
                            : 'border-cyan-500 bg-cyan-200/20'
                      "
                      :style="overlayStyle(overlay.bbox)"
                    >
                      <span
                        class="absolute -top-5 left-0 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white"
                      >
                        {{ overlay.label }}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </article>

        <aside
          class="min-h-0 rounded-2xl border border-border/70 bg-card/90 p-3 shadow-sm"
        >
          <div
            ref="leadSidebarScrollContainer"
            class="h-full min-h-0 space-y-3 overflow-y-auto pr-1"
          >
            <div
              v-if="pagesWithLeads.length === 0"
              class="text-muted-foreground rounded-lg border border-dashed border-border px-3 py-8 text-center text-sm"
            >
              No leads found for this publication yet.
            </div>

            <section
              v-for="pageEntry in pagesWithLeads"
              :key="pageEntry.pageNumber"
              :ref="(element) => setLeadPageSectionRef(pageEntry.pageNumber, element)"
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
                  <p class="text-muted-foreground mt-1 text-xs">
                    Header bbox: {{ bboxLabel(lead.enrichment?.articleHeaderBbox) }}
                  </p>

                  <div class="mt-2 space-y-1 text-xs">
                    <p>
                      <span class="text-muted-foreground">Persons:</span>
                      {{
                        formatNamesWithBboxes(
                          lead.enrichment?.personNames,
                          lead.enrichment?.personNameBoxes,
                        )
                      }}
                    </p>
                    <p>
                      <span class="text-muted-foreground">Companies:</span>
                      {{
                        formatNamesWithBboxes(
                          lead.enrichment?.companyNames,
                          lead.enrichment?.companyNameBoxes,
                        )
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
