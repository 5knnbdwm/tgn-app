import type { MutationCtx, QueryCtx } from "../_generated/server";
import { checkPermission, type Permission, type Role } from "../permissions.config";

export async function getUser(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;

  const user = await ctx.db
    .query("users")
    .withIndex("by_auth_id", (q) => q.eq("authId", identity.subject))
    .first();

  return user;
}

export async function authorize(
  ctx: QueryCtx | MutationCtx,
  permission: Permission,
  resourceOwnerId?: string,
) {
  const user = await getUser(ctx);
  if (!user) {
    throw new Error("Not authenticated");
  }

  const allowed = checkPermission(
    user.role as Role,
    user.authId,
    permission,
    resourceOwnerId,
  );

  if (!allowed) {
    throw new Error(`Permission denied: ${permission}`);
  }

  return user;
}
