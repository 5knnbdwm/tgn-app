import { createPermissions } from "#imports";
import { api } from "~~/convex/_generated/api";
import {
  checkPermission,
  type Permission,
  type Role,
} from "~~/convex/permissions.config";

export const { usePermissions, usePermissionGuard } =
  createPermissions<Permission>({
    query: api.auth.getPermissionContext,
    checkPermission: (ctx, permission, resource) => {
      if (!ctx) return false;
      return checkPermission(
        ctx.role as Role,
        ctx.userId,
        permission,
        resource?.ownerId,
      );
    },
  });
