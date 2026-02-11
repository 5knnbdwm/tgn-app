// Roles from most to least powerful
export const ROLES = ["admin", "member", "viewer"] as const;
export type Role = (typeof ROLES)[number];

type RoleRule = {
  roles: readonly Role[];
};

type OwnershipRule = {
  own?: readonly Role[];
  any?: readonly Role[];
};

type PermissionRule = RoleRule | OwnershipRule;

// Permission rules
export const permissions = {
  "publication.read": { roles: ["admin", "member", "viewer"] },
  "publication.create": { roles: ["admin", "member"] },
  "publication.retry": { roles: ["admin", "member"] },
  "publication.delete": { roles: ["admin", "member"] },
  "lead.manual.create": { roles: ["admin", "member"] },
  "user.read": { roles: ["admin"] },
  "user.create": { roles: ["admin"] },
  "user.role.update": { roles: ["admin"] },
  "system.settings.view": { roles: ["admin"] },
} as const satisfies Record<string, PermissionRule>;

export type Permission = keyof typeof permissions;

export function checkPermission(
  userRole: Role | null,
  userId: string | null,
  permission: Permission,
  resourceOwnerId?: string,
): boolean {
  if (!userRole) return false;

  const rule = permissions[permission] as PermissionRule;

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
