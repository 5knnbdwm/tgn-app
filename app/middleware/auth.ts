export default defineNuxtRouteMiddleware(async (to) => {
  const { isAuthenticated, isPending } = useConvexAuth();

  if (isPending.value) {
    await new Promise<void>((resolve) => {
      const stop = watch(isPending, (pending) => {
        if (!pending) {
          stop();
          resolve();
        }
      });
    });
  }

  if (!isAuthenticated.value) {
    return navigateTo({
      path: "/signin",
      query: to.fullPath && to.fullPath !== "/" ? { redirect: to.fullPath } : {},
    });
  }
});
