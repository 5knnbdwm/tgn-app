<script setup lang="ts">
import { api } from "~~/convex/_generated/api";
import type { Id } from "~~/convex/_generated/dataModel";
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Loader2,
  Plus,
  RefreshCw,
} from "lucide-vue-next";
import { toast } from "vue-sonner";

definePageMeta({
  middleware: "auth",
  layout: "dashboard",
  key: (route) => String(route.params.publicationId ?? ""),
});

const route = useRoute();
const router = useRouter();

const publicationId = computed(
  () => route.params.publicationId as Id<"publications">,
);
const explicitPageParam = computed(() => {
  const rawPageParam = Array.isArray(route.params.page)
    ? route.params.page[0]
    : route.params.page;
  return rawPageParam != null && rawPageParam !== "";
});
const requestedPage = computed(() => {
  const rawPageParam = Array.isArray(route.params.page)
    ? route.params.page[0]
    : route.params.page;
  const raw = Number(rawPageParam ?? 1);
  if (!Number.isFinite(raw) || raw < 1) return 1;
  return Math.floor(raw);
});

const sidebarData = useConvexQuery(
  api.publications.publicationQueries.getEditorSidebar,
  computed(() => ({
    publicationId: publicationId.value,
  })),
);
const { mutate: retryPublicationProcessing } = useConvexMutation(
  api.publications.publicationMutations.retryPublicationProcessing,
);
const { mutate: createMissedLead } = useConvexMutation(
  api.publications.publicationMutations.createMissedLead,
);

const selectedLeadId = ref<Id<"leads"> | null>(null);
const expandedPageNumber = ref<number | null>(null);
const retryingProcessing = ref(false);
const drawModePageNumber = ref<number | null>(null);
const creatingMissedLead = ref(false);
const leadSidebarScrollContainer = ref<HTMLElement | null>(null);
const leadPageSectionRefs = ref<Record<number, HTMLElement | null>>({});
const sidebar = computed(() => sidebarData.data.value);
const currentPageData = computed(() => pageData.data.value);
const publicationStatus = computed(() => sidebar.value?.publication.status);
const maxPage = computed(() => sidebar.value?.publication.pageCount ?? 1);
const pageLeads = computed(() => currentPageData.value?.leads ?? []);
const pagesWithLeads = computed(() => sidebar.value?.pagesWithLeads ?? []);
const firstLeadPage = computed(() => {
  const firstEntry = pagesWithLeads.value
    .map((entry) => entry.pageNumber)
    .sort((a, b) => a - b)[0];
  return firstEntry ?? null;
});
const currentPage = computed(() => {
  if (!explicitPageParam.value && firstLeadPage.value) {
    return firstLeadPage.value;
  }
  return requestedPage.value;
});
const pageData = useConvexQuery(
  api.publications.publicationQueries.getPage,
  computed(() => ({
    publicationId: publicationId.value,
    pageNumber: currentPage.value,
  })),
);
const pageLeadEnrichmentsData = useConvexQuery(
  api.publications.publicationQueries.getLeadEnrichmentsForPage,
  computed(() =>
    expandedPageNumber.value
      ? {
          publicationId: publicationId.value,
          pageNumber: expandedPageNumber.value,
        }
      : "skip",
  ),
);
const leadEnrichmentsByLeadId = computed(() => {
  type LeadEnrichment = NonNullable<
    NonNullable<typeof pageLeadEnrichmentsData.data.value>[number]
  >;
  const map: Record<string, LeadEnrichment> = {};
  for (const enrichment of pageLeadEnrichmentsData.data.value ?? []) {
    if (!enrichment) continue;
    map[enrichment.leadId] = enrichment;
  }
  return map;
});
const selectedLeadEnrichment = computed(() =>
  selectedLeadId.value
    ? (leadEnrichmentsByLeadId.value[selectedLeadId.value] ?? null)
    : null,
);
const sidebarPages = computed(() => {
  const pageEntries = pagesWithLeads.value;
  const byPageNumber = new Map<number, (typeof pageEntries)[number]>();
  for (const entry of pageEntries) {
    byPageNumber.set(entry.pageNumber, entry);
  }
  const pages = pageEntries.map((entry) => ({
    pageNumber: entry.pageNumber,
    leads: entry.leads,
    isGhost: false,
  }));

  if (
    currentPage.value >= 1 &&
    currentPage.value <= maxPage.value &&
    !byPageNumber.has(currentPage.value)
  ) {
    pages.push({
      pageNumber: currentPage.value,
      leads: [],
      isGhost: true,
    });
  }

  return pages.sort((a, b) => a.pageNumber - b.pageNumber);
});
const pageNumbersWithLeads = computed(() =>
  pagesWithLeads.value.map((entry) => entry.pageNumber).sort((a, b) => a - b),
);
const isDrawModeActive = computed(
  () => drawModePageNumber.value === currentPage.value,
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
  [explicitPageParam, firstLeadPage],
  async ([hasExplicitPage, firstPage]) => {
    if (hasExplicitPage || !firstPage) return;
    await router.replace({
      path: `/editor/${publicationId.value}/${firstPage}`,
      query: route.query,
    });
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

async function setPage(pageNumber: number) {
  if (pageNumber < 1 || pageNumber > maxPage.value) return;
  if (pageNumber === currentPage.value) return;
  await router.replace({
    path: `/editor/${publicationId.value}/${pageNumber}`,
    query: route.query,
  });
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

function toggleDrawForPage(pageNumber: number) {
  if (drawModePageNumber.value === pageNumber) {
    drawModePageNumber.value = null;
    return;
  }
  drawModePageNumber.value = pageNumber;
  if (pageNumber !== currentPage.value) {
    void setPage(pageNumber);
  }
}

async function handleCreateMissedLead(payload: {
  bbox: [number, number, number, number];
}) {
  if (creatingMissedLead.value) return;
  creatingMissedLead.value = true;
  try {
    await createMissedLead({
      publicationId: publicationId.value,
      pageNumber: currentPage.value,
      bbox: payload.bbox,
    });
    drawModePageNumber.value = null;
  } finally {
    creatingMissedLead.value = false;
  }
}

function confidenceLabel(score: number) {
  return `${Math.round(score)}% conf.`;
}

async function copyLeadText(value?: string) {
  const text = value?.trim();
  if (!text) return;
  if (!import.meta.client) return;
  try {
    await navigator.clipboard.writeText(text);
    toast.info("Copied to clipboard", {
      duration: 1000,
    });
  } catch {
    // Ignore clipboard errors (e.g. insecure context); click stays non-breaking.
  }
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

watch(
  currentPage,
  async (pageNumber) => {
    if (
      !pagesWithLeads.value.some((entry) => entry.pageNumber === pageNumber)
    ) {
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
    class="h-[calc(100dvh-3.5rem-1px)] overflow-hidden bg-[radial-gradient(circle_at_12%_12%,rgba(56,189,248,0.08),transparent_45%),radial-gradient(circle_at_88%_82%,rgba(249,115,22,0.08),transparent_42%)] px-4 py-5 sm:px-6 lg:px-8"
  >
    <div class="mx-auto flex h-full container flex-col gap-4">
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
        class="min-h-0 flex-1 grid gap-4 xl:grid-cols-[minmax(0,1fr)_430px]"
      >
        <PDFViewer
          :current-page-data="currentPageData"
          :current-page="currentPage"
          :page-leads="pageLeads"
          :selected-lead-id="selectedLeadId"
          :selected-lead-enrichment="selectedLeadEnrichment"
          :draw-mode-enabled="isDrawModeActive"
          @create-missed-lead="handleCreateMissedLead"
        />

        <aside
          class="min-h-0 rounded-2xl border border-border/70 bg-card/90 p-3 shadow-sm"
        >
          <div
            ref="leadSidebarScrollContainer"
            class="h-full min-h-0 space-y-3 overflow-y-auto overflow-x-hidden pr-1"
          >
            <div
              v-if="pagesWithLeads.length === 0"
              class="text-muted-foreground rounded-lg border border-dashed border-border px-3 py-8 text-center text-sm"
            >
              No leads found for this publication yet.
            </div>

            <section
              v-for="pageEntry in sidebarPages"
              :key="pageEntry.pageNumber"
              :ref="
                (element) =>
                  setLeadPageSectionRef(
                    pageEntry.pageNumber,
                    element as HTMLElement | null,
                  )
              "
              class="rounded-xl border border-border/70 p-3 space-y-2"
              :class="
                pageEntry.isGhost
                  ? 'bg-muted/35 opacity-75'
                  : 'bg-background/80'
              "
            >
              <div class="flex items-center gap-2">
                <Button
                  size="icon-xs"
                  variant="outline"
                  :disabled="pageEntry.isGhost"
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
                <Button
                  size="icon-xs"
                  :variant="
                    drawModePageNumber === pageEntry.pageNumber
                      ? 'default'
                      : 'outline'
                  "
                  class="ml-auto"
                  :disabled="
                    creatingMissedLead || pageEntry.pageNumber !== currentPage
                  "
                  :title="
                    drawModePageNumber === pageEntry.pageNumber
                      ? `Cancel missed lead mode for page ${pageEntry.pageNumber}`
                      : `Add missed lead on page ${pageEntry.pageNumber}`
                  "
                  @click="toggleDrawForPage(pageEntry.pageNumber)"
                >
                  <Loader2
                    v-if="
                      creatingMissedLead &&
                      drawModePageNumber === pageEntry.pageNumber
                    "
                    class="size-4 animate-spin"
                  />
                  <Plus
                    v-else
                    class="size-4"
                    :class="
                      drawModePageNumber === pageEntry.pageNumber
                        ? 'opacity-100'
                        : 'opacity-90'
                    "
                  />
                </Button>
              </div>

              <div
                v-if="expandedPageNumber === pageEntry.pageNumber"
                class="space-y-2"
              >
                <div
                  v-if="pageEntry.isGhost"
                  class="text-muted-foreground rounded-lg border border-dashed border-border px-3 py-4 text-xs"
                >
                  No leads on this page yet. Use the + button to draw and add a
                  missed lead.
                </div>
                <article
                  v-for="lead in pageEntry.leads"
                  :key="lead._id"
                  class="rounded-lg border bg-card p-2"
                  :class="
                    selectedLeadId === lead._id
                      ? 'border-emerald-300 ring-1 ring-emerald-200'
                      : 'border-border/70'
                  "
                  @mouseenter="selectedLeadId = lead._id"
                  @mouseleave="
                    selectedLeadId =
                      selectedLeadId === lead._id ? null : selectedLeadId
                  "
                >
                  <div class="flex items-center justify-between gap-2">
                    <p class="text-sm font-semibold">
                      {{ formatLeadCategory(lead.category) }}
                    </p>
                    <p class="text-muted-foreground text-xs">
                      {{ confidenceLabel(lead.confidenceScore) }}
                    </p>
                  </div>

                  <template v-if="lead.category === 'AI_LEAD'">
                    <template v-if="leadEnrichmentsByLeadId[lead._id]">
                      <button
                        v-if="leadEnrichmentsByLeadId[lead._id]?.articleHeader"
                        type="button"
                        class="mt-1 cursor-copy text-left text-sm hover:underline"
                        title="Click to copy header"
                        @click.stop="
                          copyLeadText(
                            leadEnrichmentsByLeadId[lead._id]?.articleHeader,
                          )
                        "
                      >
                        {{ leadEnrichmentsByLeadId[lead._id]?.articleHeader }}
                      </button>
                      <p v-else class="mt-1 text-sm">
                        No article header extracted.
                      </p>

                      <p class="text-muted-foreground mt-1 text-xs">
                        Enrichment:
                        {{
                          leadEnrichmentsByLeadId[lead._id]?.status || "PENDING"
                        }}
                      </p>
                      <div class="mt-2 space-y-1 text-xs">
                        <div class="flex flex-wrap items-center gap-1">
                          <span class="text-muted-foreground">Persons:</span>
                          <template
                            v-if="
                              leadEnrichmentsByLeadId[lead._id]?.personNames
                                ?.length
                            "
                          >
                            <button
                              v-for="personName in leadEnrichmentsByLeadId[
                                lead._id
                              ]?.personNames"
                              :key="`${lead._id}-person-${personName}`"
                              type="button"
                              class="cursor-copy rounded border border-border/70 px-1.5 py-0.5 text-left hover:bg-muted"
                              title="Click to copy person name"
                              @click.stop="copyLeadText(personName)"
                            >
                              {{ personName }}
                            </button>
                          </template>
                          <span v-else class="text-muted-foreground"> - </span>
                        </div>
                        <div class="flex flex-wrap items-center gap-1">
                          <span class="text-muted-foreground">Companies:</span>
                          <template
                            v-if="
                              leadEnrichmentsByLeadId[lead._id]?.companyNames
                                ?.length
                            "
                          >
                            <button
                              v-for="companyName in leadEnrichmentsByLeadId[
                                lead._id
                              ]?.companyNames"
                              :key="`${lead._id}-company-${companyName}`"
                              type="button"
                              class="cursor-copy rounded border border-border/70 px-1.5 py-0.5 text-left hover:bg-muted"
                              title="Click to copy company name"
                              @click.stop="copyLeadText(companyName)"
                            >
                              {{ companyName }}
                            </button>
                          </template>
                          <span v-else class="text-muted-foreground"> - </span>
                        </div>
                      </div>
                    </template>
                    <p v-else class="text-muted-foreground mt-1 text-xs">
                      Loading enrichment...
                    </p>
                  </template>
                </article>
              </div>
            </section>
          </div>
        </aside>
      </section>
    </div>
  </main>
</template>
