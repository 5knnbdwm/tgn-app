import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const roleValidator = v.union(
  v.literal("admin"),
  v.literal("member"),
  v.literal("viewer"),
);

export default defineSchema({
  users: defineTable({
    authId: v.string(),
    displayName: v.optional(v.string()),
    email: v.optional(v.string()),
    role: roleValidator,
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_auth_id", ["authId"])
    .index("by_email", ["email"]),

  publications: defineTable({
    name: v.string(),
    status: v.union(
      v.literal("PAGE_PROCESSING"),
      v.literal("PROCESS_PAGE_ERROR"),
      v.literal("LEAD_PROCESSING"),
      v.literal("PROCESS_LEAD_ERROR"),
      v.literal("NO_LEADS_FOUND"),
      v.literal("LEADS_FOUND"),
      v.literal("CONFIRMED"),
    ),
    sourceType: v.union(
      v.literal("PDF"),
      v.literal("WEBLEAD"),
      v.literal("LINKEDIN"),
      v.literal("ISSUU"),
    ),
    ownerUserId: v.optional(v.id("users")),
    publicationFileStorageId: v.id("_storage"),
    publicationFileMimeType: v.string(),
    publicationFileSize: v.number(),
    pageImageStorageIds: v.optional(v.array(v.id("_storage"))),
    pageCount: v.number(),
    maxPageWidth: v.optional(v.number()),
    maxPageHeight: v.optional(v.number()),
    numberOfLeads: v.number(),
    confirmDate: v.optional(v.number()),
    leadObtainedAt: v.optional(v.number()),
    processPageAttempt: v.number(),
    startProcessPageAt: v.optional(v.number()),
    startProcessLeadAt: v.optional(v.number()),
    errorCode: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    metadata: v.optional(
      v.object({
        publicationName: v.optional(v.string()),
        publicationDate: v.optional(v.string()),
        keywords: v.optional(v.string()),
        batchName: v.optional(v.string()),
        isWebsite: v.optional(v.boolean()),
        isLinkedinLead: v.optional(v.boolean()),
        externalRefs: v.optional(v.record(v.string(), v.string())),
      }),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  }),
  //   .index("by_status", ["status"])
  //   .index("by_ownerUserId", ["ownerUserId"])
  //   .index("by_createdAt", ["createdAt"])
  //   .index("by_status_createdAt", ["status", "createdAt"])
  //   .index("by_sourceType_createdAt", ["sourceType", "createdAt"]),

  publicationPages: defineTable({
    publicationId: v.id("publications"),
    pageNumber: v.number(),
    pageImageStorageId: v.id("_storage"),
    pageWidth: v.number(),
    pageHeight: v.number(),
    // webArticleLink: v.optional(v.string()),
    // hasScreenshot: v.optional(v.boolean()),
    createdAt: v.number(),
  })
    .index("by_publicationId_pageNumber", ["publicationId", "pageNumber"])
    .index("by_publicationId", ["publicationId"]),
  // .index("by_webArticleLink", ["webArticleLink"]),

  pageOcr: defineTable({
    publicationId: v.id("publications"),
    pageNumber: v.number(),
    engine: v.union(
      v.literal("TESSERACT"),
      v.literal("TEXTRACT"),
      v.literal("OTHER"),
    ),
    version: v.optional(v.string()),
    wordBoxes: v.array(
      v.object({
        text: v.string(),
        bbox: v.array(v.number()),
      }),
    ),
    plainText: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_publicationId_pageNumber", ["publicationId", "pageNumber"])
    .index("by_publicationId", ["publicationId"]),

  leads: defineTable({
    publicationId: v.id("publications"),
    pageNumber: v.number(),
    bbox: v.array(v.number()),
    category: v.union(v.literal("AI_LEAD"), v.literal("MISSED_LEAD")),
    confidenceScore: v.number(),
    prediction: v.optional(
      v.union(v.literal("positive"), v.literal("negative")),
    ),
    tag: v.optional(
      v.union(
        v.literal("WRONG_PREDICTION"),
        v.literal("ERP_IMPORTED"),
        v.literal("OTHER"),
      ),
    ),
    tagReason: v.optional(v.string()),
    source: v.union(
      v.literal("AI_PIPELINE"),
      v.literal("MANUAL_EDITOR"),
      v.literal("IMPORT"),
    ),
    createdByUserId: v.optional(v.id("users")),
    isDeleted: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_publicationId_pageNumber", ["publicationId", "pageNumber"])
    .index("by_publicationId", ["publicationId"])
    .index("by_category", ["category"])
    .index("by_tag", ["tag"]),

  leadEnrichments: defineTable({
    leadId: v.id("leads"),
    status: v.union(
      v.literal("PENDING"),
      v.literal("PROCESSING"),
      v.literal("DONE"),
      v.literal("ERROR"),
    ),
    articleHeader: v.optional(v.string()),
    articleHeaderBbox: v.optional(v.array(v.number())),
    personNames: v.optional(v.array(v.string())),
    personNameBoxes: v.optional(
      v.array(
        v.object({
          name: v.string(),
          bbox: v.array(v.number()),
        }),
      ),
    ),
    companyNames: v.optional(v.array(v.string())),
    companyNameBoxes: v.optional(
      v.array(
        v.object({
          name: v.string(),
          bbox: v.array(v.number()),
        }),
      ),
    ),
    errorMessage: v.optional(v.string()),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_leadId", ["leadId"])
    .index("by_status", ["status"]),

  // jobs: defineTable({
  //   type: v.union(
  //     v.literal("PROCESS_PUBLICATION"),
  //     v.literal("OCR_PAGE"),
  //     v.literal("CLASSIFY_PUBLICATION"),
  //     v.literal("ENRICH_LEAD"),
  //     v.literal("RETRY_PUBLICATION"),
  //   ),
  //   publicationId: v.optional(v.id("publications")),
  //   leadId: v.optional(v.id("leads")),
  //   status: v.union(
  //     v.literal("QUEUED"),
  //     v.literal("RUNNING"),
  //     v.literal("DONE"),
  //     v.literal("ERROR"),
  //     v.literal("CANCELLED"),
  //   ),
  //   priority: v.number(),
  //   attempt: v.number(),
  //   maxAttempts: v.number(),
  //   runAfter: v.optional(v.number()),
  //   payload: v.optional(v.any()),
  //   errorMessage: v.optional(v.string()),
  //   startedAt: v.optional(v.number()),
  //   finishedAt: v.optional(v.number()),
  //   createdAt: v.number(),
  //   updatedAt: v.number(),
  // })
  //   .index("by_status_priority", ["status", "priority"])
  //   .index("by_publicationId", ["publicationId"])
  //   .index("by_leadId", ["leadId"])
  //   .index("by_type_status", ["type", "status"]),

  // jobEvents: defineTable({
  //   jobId: v.id("jobs"),
  //   stage: v.string(),
  //   level: v.union(v.literal("INFO"), v.literal("WARN"), v.literal("ERROR")),
  //   message: v.string(),
  //   data: v.optional(v.any()),
  //   createdAt: v.number(),
  // }).index("by_jobId_createdAt", ["jobId", "createdAt"]),

  // leadTagReasons: defineTable({
  //   tag: v.string(),
  //   reason: v.string(),
  //   isActive: v.boolean(),
  //   createdAt: v.number(),
  // }).index("by_tag", ["tag"]),
});
