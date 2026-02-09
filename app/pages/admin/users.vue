<script setup lang="ts">
import { api } from "~~/convex/_generated/api";
import type { Id } from "~~/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

definePageMeta({ middleware: "auth", layout: "dashboard" });

type AppRole = "admin" | "member" | "viewer";

usePermissionGuard({ permission: "user.read", redirectTo: "/" });

const permissionContextQuery = useConvexQuery(
  api.auth.getPermissionContext,
  {},
);
const permissionContext = computed(() => permissionContextQuery.data.value);

const usersQuery = useConvexQuery(api.users.listUsers, {});
const users = computed(() => usersQuery.data.value ?? []);
const loadingUsers = computed(() => usersQuery.status.value === "pending");

const { mutate: setUserRole } = useConvexMutation(api.users.setUserRole);
const { mutate: setUserRoleByAuthId } = useConvexMutation(
  api.users.setUserRoleByAuthId,
);

const creating = ref(false);
const createError = ref<string | null>(null);
const createSuccess = ref<string | null>(null);
const rowError = ref<string | null>(null);
const updatingUserId = ref<Id<"users"> | null>(null);

const form = reactive({
  name: "",
  email: "",
  password: "",
  role: "member" as AppRole,
});

const roleOptions: AppRole[] = ["admin", "member", "viewer"];

function toAuthRole(role: AppRole): "admin" | "user" {
  return role === "admin" ? "admin" : "user";
}

function formatDateTime(timestamp?: number) {
  if (!timestamp) return "-";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(timestamp);
}

async function createUser() {
  createError.value = null;
  createSuccess.value = null;
  rowError.value = null;
  creating.value = true;

  try {
    const created = await $fetch<{ user: { id: string } }>(
      "/api/auth/admin/create-user",
      {
        method: "POST",
        credentials: "include",
        body: {
          email: form.email,
          password: form.password,
          name: form.name,
          role: toAuthRole(form.role),
        },
      },
    );

    await setUserRoleByAuthId({
      authId: created.user.id,
      role: form.role,
    });

    form.name = "";
    form.email = "";
    form.password = "";
    form.role = "member";
    createSuccess.value = "User created";
  } catch (error) {
    createError.value =
      error instanceof Error ? error.message : "Failed to create user";
  } finally {
    creating.value = false;
  }
}

async function updateRole(userId: Id<"users">, authId: string, role: AppRole) {
  rowError.value = null;
  updatingUserId.value = userId;

  try {
    await $fetch("/api/auth/admin/set-role", {
      method: "POST",
      credentials: "include",
      body: {
        userId: authId,
        role: toAuthRole(role),
      },
    });

    await setUserRole({
      userId,
      role,
    });
  } catch (error) {
    rowError.value =
      error instanceof Error ? error.message : "Failed to update role";
  } finally {
    updatingUserId.value = null;
  }
}

function handleRoleSelect(userId: Id<"users">, authId: string, event: Event) {
  const nextRole = (event.target as HTMLSelectElement).value as AppRole;
  void updateRole(userId, authId, nextRole);
}
</script>

<template>
  <main
    class="min-h-dvh bg-[radial-gradient(circle_at_0%_0%,rgba(15,23,42,0.08),transparent_38%),radial-gradient(circle_at_95%_10%,rgba(180,83,9,0.14),transparent_36%),linear-gradient(180deg,#f8fafc_0%,#f7f1e7_100%)] px-4 py-6 dark:bg-[radial-gradient(circle_at_0%_0%,rgba(56,189,248,0.14),transparent_42%),radial-gradient(circle_at_95%_10%,rgba(245,158,11,0.12),transparent_40%),linear-gradient(180deg,rgba(9,13,20,0.98)_0%,rgba(7,10,16,0.98)_100%)] sm:px-6 lg:px-8"
  >
    <div class="mx-auto container space-y-6">
      <header
        class="rounded-2xl border border-border/70 bg-card/90 p-5 shadow-sm backdrop-blur dark:border-border/80 dark:bg-card/95"
      >
        <h1 class="text-2xl font-semibold tracking-tight sm:text-3xl">
          User Management
        </h1>
        <p class="text-muted-foreground mt-1 text-sm sm:text-base">
          Admins can create users and assign application roles.
        </p>
      </header>

      <section
        class="grid gap-5 rounded-2xl border border-border/70 bg-card/90 p-5 shadow-sm dark:border-border/80 dark:bg-card/95"
      >
        <h2 class="text-lg font-semibold">Create User</h2>
        <form class="grid gap-3 md:grid-cols-2" @submit.prevent="createUser">
          <div class="grid gap-2">
            <Label for="name">Name</Label>
            <Input
              id="name"
              v-model="form.name"
              placeholder="Ada Lovelace"
              autocomplete="name"
              required
            />
          </div>

          <div class="grid gap-2">
            <Label for="email">Email</Label>
            <Input
              id="email"
              v-model="form.email"
              type="email"
              placeholder="user@company.com"
              autocomplete="email"
              required
            />
          </div>

          <div class="grid gap-2">
            <Label for="password">Password</Label>
            <Input
              id="password"
              v-model="form.password"
              type="password"
              minlength="8"
              autocomplete="new-password"
              required
            />
          </div>

          <div class="grid gap-2">
            <Label for="role">Role</Label>
            <select
              id="role"
              v-model="form.role"
              class="border-input bg-background ring-offset-background focus-visible:ring-ring inline-flex h-10 w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none dark:bg-input/45"
            >
              <option value="admin">admin</option>
              <option value="member">member</option>
              <option value="viewer">viewer</option>
            </select>
          </div>

          <div class="md:col-span-2 flex items-center gap-3">
            <Button type="submit" :disabled="creating">
              {{ creating ? "Creating..." : "Create User" }}
            </Button>
            <p v-if="createSuccess" class="text-sm text-emerald-700 dark:text-emerald-300">
              {{ createSuccess }}
            </p>
            <p v-if="createError" class="text-sm text-red-700 dark:text-red-300">
              {{ createError }}
            </p>
          </div>
        </form>
      </section>

      <section
        class="rounded-2xl border border-border/70 bg-card/90 p-5 shadow-sm dark:border-border/80 dark:bg-card/95"
      >
        <div class="mb-3 flex items-center justify-between gap-3">
          <h2 class="text-lg font-semibold">Users</h2>
          <Badge variant="secondary"> {{ users.length }} total </Badge>
        </div>

        <p
          v-if="rowError"
          class="mb-3 rounded-md bg-red-100 px-3 py-2 text-sm text-red-700 dark:bg-red-950/35 dark:text-red-200"
        >
          {{ rowError }}
        </p>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableEmpty v-if="loadingUsers">Loading users...</TableEmpty>
            <TableEmpty v-else-if="users.length === 0"
              >No users found.</TableEmpty
            >
            <TableRow v-for="user in users" v-else :key="user._id">
              <TableCell class="font-medium">
                {{ user.displayName ?? "—" }}
              </TableCell>
              <TableCell>
                {{ user.email ?? "—" }}
              </TableCell>
              <TableCell>
                <select
                  :value="user.role"
                  class="border-input bg-background ring-offset-background focus-visible:ring-ring inline-flex h-9 rounded-md border px-2 text-sm focus-visible:ring-2 focus-visible:outline-none dark:bg-input/45"
                  :disabled="
                    updatingUserId === user._id ||
                    user.authId === permissionContext?.userId
                  "
                  @change="handleRoleSelect(user._id, user.authId, $event)"
                >
                  <option v-for="role in roleOptions" :key="role" :value="role">
                    {{ role }}
                  </option>
                </select>
              </TableCell>
              <TableCell>
                {{ formatDateTime(user.createdAt) }}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </section>
    </div>
  </main>
</template>
