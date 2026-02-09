<script setup lang="ts">
import { ZoomIn, ZoomOut } from "lucide-vue-next";

type NameBox = {
  name: string;
  bbox: number[];
};

type Lead = {
  _id: string;
  bbox: number[];
  enrichment?: {
    articleHeaderBbox?: number[];
    personNameBoxes?: NameBox[];
    companyNameBoxes?: NameBox[];
  } | null;
};

type CurrentPageData = {
  pageImageUrl?: string | null;
  page?: {
    pageWidth: number;
    pageHeight: number;
  } | null;
};

const props = defineProps<{
  currentPageData?: CurrentPageData | null;
  currentPage: number;
  pageLeads: Lead[];
  selectedLeadId: string | null;
}>();

const pageImageScrollContainer = ref<HTMLElement | null>(null);
const isDraggingImage = ref(false);
const imageDragStart = ref<{
  x: number;
  y: number;
  scrollLeft: number;
  scrollTop: number;
} | null>(null);
const MIN_ZOOM = 100;
const MAX_ZOOM = 300;
const ZOOM_STEP = 25;
const zoomPercent = ref(100);
const ZOOM_GUTTER_PX = 12;
const zoomSurfaceStyle = computed(() => ({
  width: `${Math.max(zoomPercent.value, 100)}%`,
}));
const zoomFrameStyle = computed(() => ({
  width: `calc(100% - ${ZOOM_GUTTER_PX * 2}px)`,
}));

function zoomIn() {
  zoomPercent.value = Math.min(MAX_ZOOM, zoomPercent.value + ZOOM_STEP);
}

function zoomOut() {
  zoomPercent.value = Math.max(MIN_ZOOM, zoomPercent.value - ZOOM_STEP);
}

function resetZoom() {
  zoomPercent.value = 100;
}

function onImageDragStart(event: MouseEvent) {
  if (event.button !== 0) return;
  const imageContainer = pageImageScrollContainer.value;
  if (!imageContainer) return;

  isDraggingImage.value = true;
  imageDragStart.value = {
    x: event.clientX,
    y: event.clientY,
    scrollLeft: imageContainer.scrollLeft,
    scrollTop: imageContainer.scrollTop,
  };

  window.addEventListener("mousemove", onImageDragMove);
  window.addEventListener("mouseup", onImageDragEnd);
  event.preventDefault();
}

function onImageDragMove(event: MouseEvent) {
  if (!isDraggingImage.value) return;
  const imageContainer = pageImageScrollContainer.value;
  const start = imageDragStart.value;
  if (!imageContainer || !start) return;

  imageContainer.scrollLeft = start.scrollLeft - (event.clientX - start.x);
  imageContainer.scrollTop = start.scrollTop - (event.clientY - start.y);
}

function onImageDragEnd() {
  if (!isDraggingImage.value) return;
  isDraggingImage.value = false;
  imageDragStart.value = null;
  window.removeEventListener("mousemove", onImageDragMove);
  window.removeEventListener("mouseup", onImageDragEnd);
}

const selectedLead = computed(
  () =>
    props.pageLeads.find((lead) => lead._id === props.selectedLeadId) ?? null,
);

const selectedLeadEnrichmentOverlays = computed(() => {
  const enrichment = selectedLead.value?.enrichment;
  if (!enrichment) return [];

  const overlays: Array<{
    key: string;
    kind: "header" | "person" | "company";
    label: string;
    bbox: number[];
    labelLane: number;
    labelBelow: boolean;
  }> = [];

  if (enrichment.articleHeaderBbox?.length === 4) {
    overlays.push({
      key: "header",
      kind: "header",
      label: "Header",
      bbox: enrichment.articleHeaderBbox,
      labelLane: 0,
      labelBelow: false,
    });
  }

  (enrichment.personNameBoxes ?? []).forEach(
    (entry: NameBox, index: number) => {
      if (entry.bbox?.length === 4) {
        overlays.push({
          key: `person-${entry.name}-${index}`,
          kind: "person",
          label: `Person: ${entry.name}`,
          bbox: entry.bbox,
          labelLane: 0,
          labelBelow: false,
        });
      }
    },
  );

  (enrichment.companyNameBoxes ?? []).forEach(
    (entry: NameBox, index: number) => {
      if (entry.bbox?.length === 4) {
        overlays.push({
          key: `company-${entry.name}-${index}`,
          kind: "company",
          label: `Company: ${entry.name}`,
          bbox: entry.bbox,
          labelLane: 0,
          labelBelow: false,
        });
      }
    },
  );

  const labelHeight = 18;
  const labelGap = 4;
  const laneStep = labelHeight + 2;
  const positioned: Array<{
    key: string;
    kind: "header" | "person" | "company";
    label: string;
    bbox: number[];
    labelLane: number;
    labelBelow: boolean;
    x1: number;
    x2: number;
    y: number;
  }> = [];
  const sortedOverlays = overlays.slice().sort((left, right) => {
    if (!Array.isArray(left.bbox) || left.bbox.length < 2) return 0;
    if (!Array.isArray(right.bbox) || right.bbox.length < 2) return 0;
    return (
      (left.bbox[1] ?? 0) - (right.bbox[1] ?? 0) ||
      (left.bbox[0] ?? 0) - (right.bbox[0] ?? 0)
    );
  });

  for (const overlay of sortedOverlays) {
    const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = overlay.bbox;
    const labelWidth = Math.max(
      70,
      Math.min(240, overlay.label.length * 7 + 18),
    );
    const labelX1 = x1;
    const labelX2 = x1 + labelWidth;

    let lane = 0;
    let placeBelow = false;
    let labelY = y1 - (labelHeight + labelGap);
    while (lane < 8) {
      labelY = y1 - (labelHeight + labelGap + lane * laneStep);
      if (labelY < 0) {
        placeBelow = true;
        lane = 0;
        break;
      }
      const collides = positioned.some(
        (placed) =>
          !placed.labelBelow &&
          Math.abs(placed.y - labelY) < labelHeight &&
          Math.max(placed.x1, labelX1) < Math.min(placed.x2, labelX2),
      );
      if (!collides) break;
      lane += 1;
    }

    if (placeBelow) {
      while (lane < 8) {
        labelY = y2 + labelGap + lane * laneStep;
        const collides = positioned.some(
          (placed) =>
            placed.labelBelow &&
            Math.abs(placed.y - labelY) < labelHeight &&
            Math.max(placed.x1, labelX1) < Math.min(placed.x2, labelX2),
        );
        if (!collides) break;
        lane += 1;
      }
    }

    positioned.push({
      ...overlay,
      labelLane: lane,
      labelBelow: placeBelow,
      x1: labelX1,
      x2: labelX2,
      y: labelY,
    });
  }

  return positioned;
});

function overlayStyle(bbox: number[]) {
  const page = props.currentPageData?.page;
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

function overlayLabelStyle(overlay: {
  labelLane: number;
  labelBelow: boolean;
}) {
  const labelHeight = 18;
  const labelGap = 4;
  const laneStep = labelHeight + 2;
  const offset = labelGap + overlay.labelLane * laneStep;
  if (overlay.labelBelow) {
    return {
      left: "0px",
      top: `calc(100% + ${offset}px)`,
    };
  }
  return {
    left: "0px",
    top: `-${labelHeight + offset}px`,
  };
}

onBeforeUnmount(() => {
  window.removeEventListener("mousemove", onImageDragMove);
  window.removeEventListener("mouseup", onImageDragEnd);
});
</script>

<template>
  <article
    class="relative min-h-0 rounded-2xl border border-border/70 bg-card/90 p-3 shadow-sm"
  >
    <div
      class="absolute top-5 right-5 z-20 flex items-center gap-2 rounded-lg border border-border/80 bg-background/95 p-1.5 shadow-sm backdrop-blur"
    >
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
      ref="pageImageScrollContainer"
      class="h-full overflow-auto rounded-xl border border-border/70 bg-muted/20 p-3 pt-14"
      :class="isDraggingImage ? 'cursor-grabbing select-none' : 'cursor-grab'"
      @mousedown="onImageDragStart"
    >
      <div
        v-if="!props.currentPageData?.pageImageUrl"
        class="text-muted-foreground flex min-h-[560px] items-center justify-center rounded-lg border border-dashed border-border text-sm"
      >
        Page image unavailable.
      </div>

      <div v-else class="flex min-w-full items-start" :style="zoomSurfaceStyle">
        <div
          class="shrink-0"
          :style="{ width: `${ZOOM_GUTTER_PX}px` }"
        />
        <div
          class="relative box-border border border-border bg-white shadow-inner"
          :style="zoomFrameStyle"
        >
          <img
            :src="props.currentPageData.pageImageUrl"
            :alt="`Publication page ${props.currentPage}`"
            class="block h-auto w-full object-contain select-none"
            draggable="false"
          />
          <div class="pointer-events-none absolute inset-0">
            <div
              v-for="lead in props.pageLeads"
              :key="lead._id"
              class="absolute border-2 transition-colors"
              :class="
                lead._id === props.selectedLeadId
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
                class="absolute left-0 max-w-[240px] truncate rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white"
                :style="overlayLabelStyle(overlay)"
              >
                {{ overlay.label }}
              </span>
            </div>
          </div>
        </div>
        <div
          class="shrink-0"
          :style="{ width: `${ZOOM_GUTTER_PX}px` }"
        />
      </div>
    </div>
  </article>
</template>
