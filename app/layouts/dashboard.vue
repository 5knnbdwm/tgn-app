<script setup lang="ts">
import { useAuthClient } from "#imports";
import { Moon, Sun } from "lucide-vue-next";
import { api } from "~~/convex/_generated/api";

const authClient = useAuthClient();
const { isAuthenticated, isPending } = useConvexAuth();
const permissionContextQuery = useConvexQuery(
  api.auth.getPermissionContext,
  {},
);
const permissionContext = computed(() => permissionContextQuery.data.value);
const userQuery = useConvexQuery(api.users.getOwnUser, {});
const user = computed(() => userQuery.data.value);
const colorMode = useColorMode();
const route = useRoute();

watch(
  [isPending, isAuthenticated],
  async ([pending, authenticated]) => {
    if (!pending && !authenticated) {
      await navigateTo("/signin");
    }
  },
  { immediate: true },
);

const isDarkMode = computed(() => colorMode.value === "dark");
const navItems = computed(() => {
  const items = [{ label: "Publications", to: "/" }];

  if (permissionContext.value?.role === "admin") {
    items.push({ label: "Users", to: "/admin/users" });
  }

  return items;
});

function isActivePath(path: string) {
  return route.path === path || route.path.startsWith(`${path}/`);
}

function toggleColorMode() {
  colorMode.preference = isDarkMode.value ? "light" : "dark";
}

async function signOut() {
  if (!authClient) return;

  await authClient.signOut();
  await navigateTo("/signin");
}
</script>

<template>
  <div class="min-h-dvh bg-background text-foreground">
    <header
      class="sticky top-0 z-40 border-b border-border/80 bg-background/90 backdrop-blur"
    >
      <div
        class="mx-auto flex h-14 w-full max-w-[1400px] items-center justify-between gap-3 px-4 sm:px-6 lg:px-8"
      >
        <div class="flex items-center gap-4">
          <div
            class="size-2 rounded-full bg-emerald-500"
            :class="isAuthenticated ? 'opacity-100' : 'opacity-40'"
          />
          <p class="text-sm font-semibold tracking-wide">TGN Research</p>

          <nav
            v-if="isAuthenticated"
            class="hidden items-center gap-1 rounded-lg border border-border/70 bg-muted/30 p-1 md:flex"
          >
            <NuxtLink
              v-for="item in navItems"
              :key="item.to"
              :to="item.to"
              class="inline-flex h-8 items-center rounded-md px-3 text-sm transition-colors"
              :class="
                isActivePath(item.to)
                  ? 'bg-background text-foreground shadow-xs'
                  : 'text-muted-foreground hover:bg-background/70 hover:text-foreground'
              "
            >
              {{ item.label }}
            </NuxtLink>
          </nav>
        </div>

        <div class="flex items-center gap-2">
          <p v-if="isPending" class="text-muted-foreground text-sm">
            Checking session...
          </p>
          <p
            v-else-if="isAuthenticated"
            class="text-muted-foreground hidden rounded-md bg-muted/40 px-2.5 py-1 text-sm md:block"
          >
            Logged in: {{ user?.displayName ?? "Unknown" }}
          </p>

          <button
            type="button"
            class="border-input hover:bg-muted inline-flex h-9 w-9 items-center justify-center rounded-md border transition-colors"
            :aria-label="
              isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'
            "
            :title="isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'"
            @click="toggleColorMode"
          >
            <Sun v-if="isDarkMode" class="size-4" />
            <Moon v-else class="size-4" />
          </button>

          <button
            type="button"
            class="text-muted-foreground hover:text-foreground inline-flex h-9 items-center rounded-md px-2 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60"
            :disabled="!isAuthenticated"
            @click="signOut"
          >
            Logout
          </button>
        </div>
      </div>
    </header>

    <slot />
  </div>
</template>
