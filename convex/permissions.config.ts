// Roles from most to least powerful
export const ROLES = ["admin", "member", "viewer"] as const;
export type Role = (typeof ROLES)[number];

// Permission rules
export const permissions = {
  "task.create": { roles: ["admin", "member"] },
  "task.read": { roles: ["admin", "member", "viewer"] },
  "task.update": { own: ["member"], any: ["admin"] },
  "task.delete": { own: ["member"], any: ["admin"] },
  "settings.view": { roles: ["admin"] },
} as const;

export type Permission = keyof typeof permissions;

export function checkPermission(
  userRole: Role | null,
  userId: string | null,
  permission: Permission,
  resourceOwnerId?: string,
): boolean {
  if (!userRole) return false;

  const rule = permissions[permission];

  if ("roles" in rule) {
    return (rule.roles as readonly string[]).includes(userRole);
  }

  if ("any" in rule && (rule.any as readonly string[]).includes(userRole)) {
    return true;
  }

  if ("own" in rule && (rule.own as readonly string[]).includes(userRole)) {
    return resourceOwnerId === userId;
  }

  return false;
}
