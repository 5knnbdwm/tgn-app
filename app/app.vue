<script setup lang="ts">
const { state } = useConvexConnectionState();

// Debug: log all state changes
watch(
  state,
  (newState) => {
    console.log("Connection state:", {
      connected: newState.isWebSocketConnected,
      retries: newState.connectionRetries,
      pendingMutations: newState.inflightMutations,
      pendingActions: newState.inflightActions,
      oldestRequest: newState.timeOfOldestInflightRequest,
    });
  },
  { immediate: true, deep: true },
);
</script>

<template>
  <NuxtPage />
</template>
