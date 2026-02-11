import { R2 } from "@convex-dev/r2";
import { components } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { authorize } from "./lib/permissions";

export const r2 = new R2(components.r2);

export const { generateUploadUrl, syncMetadata } = r2.clientApi<DataModel>({
  checkUpload: async (ctx) => {
    await authorize(ctx as unknown as QueryCtx, "publication.create");
  },
  checkReadKey: async (ctx) => {
    await authorize(ctx as unknown as QueryCtx, "publication.read");
  },
});
