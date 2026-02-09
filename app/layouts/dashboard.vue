<script setup lang="ts">
import { useAuthClient } from "#imports";
import { api } from "~~/convex/_generated/api";

const authClient = useAuthClient();
const { isAuthenticated, isPending } = useConvexAuth();
const permissionContextQuery = useConvexQuery(
  api.auth.getPermissionContext,
  {},
);
const permissionContext = computed(() => permissionContextQuery.data.value);
const colorMode = useColorMode();

const isDarkMode = computed(() => colorMode.value === "dark");

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
        <div class="flex items-center gap-2">
          <div
            class="size-2 rounded-full bg-emerald-500"
            :class="isAuthenticated ? 'opacity-100' : 'opacity-40'"
          />
          <p class="text-sm font-semibold tracking-wide">TGN Research</p>
        </div>

        <div class="flex items-center gap-2">
          <p v-if="isPending" class="text-muted-foreground text-sm">
            Checking session...
          </p>
          <p
            v-else-if="isAuthenticated"
            class="text-muted-foreground hidden text-sm md:block"
          >
            Logged in
            {{ permissionContext?.role ? ` as ${permissionContext.role}` : "" }}
          </p>

          <NuxtLink
            v-if="permissionContext?.role === 'admin'"
            to="/admin/users"
            class="border-input hover:bg-muted inline-flex h-9 items-center rounded-md border px-3 text-sm"
          >
            Users
          </NuxtLink>

          <button
            type="button"
            class="border-input hover:bg-muted inline-flex h-9 items-center rounded-md border px-3 text-sm"
            @click="toggleColorMode"
          >
            {{ isDarkMode ? "Light" : "Dark" }}
          </button>

          <button
            type="button"
            class="inline-flex h-9 items-center rounded-md bg-[#8f361f] px-3 text-sm font-medium text-white hover:bg-[#7d301b] disabled:cursor-not-allowed disabled:opacity-60"
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
