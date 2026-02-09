import { v } from "convex/values";

export const publicationStatusValidator = v.union(
  v.literal("PAGE_PROCESSING"),
  v.literal("PROCESS_PAGE_ERROR"),
  v.literal("LEAD_PROCESSING"),
  v.literal("PROCESS_LEAD_ERROR"),
  v.literal("NO_LEADS_FOUND"),
  v.literal("LEADS_FOUND"),
  v.literal("CONFIRMED"),
);

export const sourceTypeValidator = v.union(
  v.literal("PDF"),
  v.literal("WEBLEAD"),
  v.literal("LINKEDIN"),
  v.literal("ISSUU"),
);

export const leadCategoryValidator = v.union(
  v.literal("AI_LEAD"),
  v.literal("MISSED_LEAD"),
);

export const leadTagValidator = v.union(
  v.literal("WRONG_PREDICTION"),
  v.literal("ERP_IMPORTED"),
  v.literal("OTHER"),
);

export const leadSourceValidator = v.union(
  v.literal("AI_PIPELINE"),
  v.literal("MANUAL_EDITOR"),
  v.literal("IMPORT"),
);

export const bboxValidator = v.array(v.number());

export type SourceType = "PDF" | "WEBLEAD" | "LINKEDIN" | "ISSUU";

export type BBox = [number, number, number, number];

export type PublicationStatus =
  | "PAGE_PROCESSING"
  | "PROCESS_PAGE_ERROR"
  | "LEAD_PROCESSING"
  | "PROCESS_LEAD_ERROR"
  | "NO_LEADS_FOUND"
  | "LEADS_FOUND"
  | "CONFIRMED";

export type LeadTag = "WRONG_PREDICTION" | "ERP_IMPORTED" | "OTHER";

export function nowTs() {
  return Date.now();
}

export function assertBbox(bbox: number[]): BBox {
  if (bbox.length !== 4) {
    throw new Error("Bounding box must contain 4 numbers [x1,y1,x2,y2]");
  }

  const normalized = bbox as [number, number, number, number];
  const [x1, y1, x2, y2] = normalized;
  if (x2 <= x1 || y2 <= y1) {
    throw new Error("Bounding box must satisfy x2>x1 and y2>y1");
  }
  return normalized;
}

export function overlaps(a: BBox, b: BBox) {
  const x1 = Math.max(a[0], b[0]);
  const y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(a[2], b[2]);
  const y2 = Math.min(a[3], b[3]);
  return x2 > x1 && y2 > y1;
}

export function bboxArea(b: BBox) {
  return Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
}
