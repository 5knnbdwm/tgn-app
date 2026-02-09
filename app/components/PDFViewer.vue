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
  drawModeEnabled?: boolean;
}>();
const emit = defineEmits<{
  (
    event: "create-missed-lead",
    payload: { bbox: [number, number, number, number] },
  ): void;
}>();

const pageImageScrollContainer = ref<HTMLElement | null>(null);
const pageOverlayRef = ref<HTMLElement | null>(null);
const isDraggingImage = ref(false);
const imageDragStart = ref<{
  x: number;
  y: number;
  scrollLeft: number;
  scrollTop: number;
} | null>(null);
const MAX_ZOOM = 300;
const ZOOM_STEP = 25;
const zoomPercent = ref(100);
const ZOOM_GUTTER_PX = 12;
const viewportInnerWidth = ref(0);
const viewportInnerHeight = ref(0);
let viewportResizeObserver: ResizeObserver | null = null;
let drawMoveListener: ((event: MouseEvent) => void) | null = null;
let drawEndListener: ((event: MouseEvent) => void) | null = null;
const drawStartPoint = ref<{ x: number; y: number } | null>(null);
const drawCurrentPoint = ref<{ x: number; y: number } | null>(null);
const isDrawingBox = ref(false);
const MIN_DRAW_SIZE_PX = 8;
const fitHeightZoom = computed(() => {
  const page = props.currentPageData?.page;
  if (!page) return 100;
  if (page.pageWidth <= 0 || page.pageHeight <= 0) return 100;
  if (viewportInnerWidth.value <= 0 || viewportInnerHeight.value <= 0) {
    return 100;
  }

  const frameWidthAtHundred = Math.max(
    1,
    viewportInnerWidth.value - ZOOM_GUTTER_PX * 2,
  );
  const frameHeightAtHundred = frameWidthAtHundred * (page.pageHeight / page.pageWidth);
  if (frameHeightAtHundred <= 0) return 100;

  const rawFit = (viewportInnerHeight.value / frameHeightAtHundred) * 100;
  return Math.max(40, Math.min(100, Math.round(rawFit)));
});
const minZoom = computed(() => fitHeightZoom.value);
const zoomSurfaceStyle = computed(() => ({
  justifyContent: zoomPercent.value <= 100 ? "center" : "flex-start",
}));
const zoomFrameStyle = computed(() => ({
  width: `calc((100% - ${ZOOM_GUTTER_PX * 2}px) * ${zoomPercent.value / 100})`,
}));

function measureViewport() {
  const container = pageImageScrollContainer.value;
  if (!container) return;
  const styles = getComputedStyle(container);
  const paddingLeft = Number.parseFloat(styles.paddingLeft) || 0;
  const paddingRight = Number.parseFloat(styles.paddingRight) || 0;
  const paddingTop = Number.parseFloat(styles.paddingTop) || 0;
  const paddingBottom = Number.parseFloat(styles.paddingBottom) || 0;

  viewportInnerWidth.value = Math.max(
    0,
    container.clientWidth - paddingLeft - paddingRight,
  );
  viewportInnerHeight.value = Math.max(
    0,
    container.clientHeight - paddingTop - paddingBottom,
  );
}

function zoomIn() {
  if (zoomPercent.value < 100) {
    zoomPercent.value = 100;
    return;
  }
  zoomPercent.value = Math.min(MAX_ZOOM, zoomPercent.value + ZOOM_STEP);
}

function zoomOut() {
  if (zoomPercent.value > 100) {
    zoomPercent.value = Math.max(100, zoomPercent.value - ZOOM_STEP);
    return;
  }
  zoomPercent.value = minZoom.value;
}

function resetZoom() {
  zoomPercent.value = 100;
}

function onImageDragStart(event: MouseEvent) {
  if (props.drawModeEnabled) return;
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

function removeDrawListeners() {
  if (drawMoveListener) {
    window.removeEventListener("mousemove", drawMoveListener);
    drawMoveListener = null;
  }
  if (drawEndListener) {
    window.removeEventListener("mouseup", drawEndListener);
    drawEndListener = null;
  }
}

function resetDrawState() {
  isDrawingBox.value = false;
  drawStartPoint.value = null;
  drawCurrentPoint.value = null;
  removeDrawListeners();
}

function pointFromMouseEvent(event: MouseEvent) {
  const overlay = pageOverlayRef.value;
  if (!overlay) return null;
  const rect = overlay.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const x = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
  const y = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
  return { x, y, width: rect.width, height: rect.height };
}

function onDrawStart(event: MouseEvent) {
  if (!props.drawModeEnabled || !props.currentPageData?.page) return;
  if (event.button !== 0) return;
  const point = pointFromMouseEvent(event);
  if (!point) return;

  isDrawingBox.value = true;
  drawStartPoint.value = { x: point.x, y: point.y };
  drawCurrentPoint.value = { x: point.x, y: point.y };

  drawMoveListener = (moveEvent: MouseEvent) => {
    if (!isDrawingBox.value) return;
    const nextPoint = pointFromMouseEvent(moveEvent);
    if (!nextPoint) return;
    drawCurrentPoint.value = { x: nextPoint.x, y: nextPoint.y };
  };
  drawEndListener = (upEvent: MouseEvent) => {
    if (!isDrawingBox.value) {
      resetDrawState();
      return;
    }
    const page = props.currentPageData?.page;
    const start = drawStartPoint.value;
    const end = pointFromMouseEvent(upEvent) ?? drawCurrentPoint.value;
    if (!page || !start || !end) {
      resetDrawState();
      return;
    }

    const x1 = Math.min(start.x, end.x);
    const y1 = Math.min(start.y, end.y);
    const x2 = Math.max(start.x, end.x);
    const y2 = Math.max(start.y, end.y);
    if (
      (x2 - x1) * end.width < MIN_DRAW_SIZE_PX ||
      (y2 - y1) * end.height < MIN_DRAW_SIZE_PX
    ) {
      resetDrawState();
      return;
    }

    emit("create-missed-lead", {
      bbox: [
        Math.round(x1 * page.pageWidth),
        Math.round(y1 * page.pageHeight),
        Math.round(x2 * page.pageWidth),
        Math.round(y2 * page.pageHeight),
      ],
    });
    resetDrawState();
  };
  window.addEventListener("mousemove", drawMoveListener);
  window.addEventListener("mouseup", drawEndListener);
  event.preventDefault();
}

const draftBoxStyle = computed(() => {
  const start = drawStartPoint.value;
  const end = drawCurrentPoint.value;
  if (!start || !end) return null;

  const left = Math.min(start.x, end.x) * 100;
  const top = Math.min(start.y, end.y) * 100;
  const width = Math.abs(end.x - start.x) * 100;
  const height = Math.abs(end.y - start.y) * 100;
  return {
    left: `${left}%`,
    top: `${top}%`,
    width: `${width}%`,
    height: `${height}%`,
  };
});

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
    const [x1 = 0, y1 = 0, _x2 = 0, y2 = 0] = overlay.bbox;
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
  viewportResizeObserver?.disconnect();
  viewportResizeObserver = null;
  resetDrawState();
});

onMounted(async () => {
  await nextTick();
  measureViewport();
  const container = pageImageScrollContainer.value;
  if (!container) return;
  viewportResizeObserver = new ResizeObserver(() => {
    measureViewport();
  });
  viewportResizeObserver.observe(container);
});

watch(
  () => [
    props.currentPageData?.page?.pageWidth,
    props.currentPageData?.page?.pageHeight,
  ],
  async () => {
    await nextTick();
    measureViewport();
    if (zoomPercent.value < 100) {
      zoomPercent.value = minZoom.value;
    }
  },
);

watch(
  () => props.drawModeEnabled,
  (enabled) => {
    if (!enabled) {
      resetDrawState();
    }
  },
);
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
        :disabled="zoomPercent <= minZoom"
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
      :class="
        props.drawModeEnabled
          ? 'cursor-default'
          : isDraggingImage
            ? 'cursor-grabbing select-none'
            : 'cursor-grab'
      "
      @mousedown="onImageDragStart"
    >
      <div
        v-if="!props.currentPageData?.pageImageUrl"
        class="text-muted-foreground flex min-h-[560px] items-center justify-center rounded-lg border border-dashed border-border text-sm"
      >
        Page image unavailable.
      </div>

      <div v-else class="flex w-full items-start" :style="zoomSurfaceStyle">
        <div
          class="shrink-0"
          :style="{ width: `${ZOOM_GUTTER_PX}px` }"
        />
        <div
          class="relative box-border shrink-0 border border-border bg-white shadow-inner"
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
          <div
            ref="pageOverlayRef"
            class="absolute inset-0 z-10"
            :class="props.drawModeEnabled ? 'pointer-events-auto cursor-crosshair' : 'pointer-events-none'"
            @mousedown.stop="onDrawStart"
          >
            <div
              v-if="props.drawModeEnabled"
              class="pointer-events-none absolute top-2 left-2 rounded bg-black/70 px-2 py-1 text-[10px] font-medium tracking-wide text-white"
            >
              Drag to add MISSED_LEAD
            </div>
            <div
              v-if="draftBoxStyle"
              class="pointer-events-none absolute border-2 border-rose-500 bg-rose-300/20"
              :style="draftBoxStyle"
            />
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
