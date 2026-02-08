<script setup lang="ts">
const router = useRouter();
const authClient = useAuthClient();
const { isAuthenticated } = useConvexAuth();

const email = ref("");
const password = ref("");
const error = ref<string | null>(null);
const loading = ref(false);

// Redirect to home if already authenticated
watch(
  isAuthenticated,
  (authenticated) => {
    if (authenticated) {
      router.push("/");
    }
  },
  { immediate: true },
);

async function handleSignIn() {
  if (!authClient) return;

  error.value = null;
  loading.value = true;

  try {
    const { error: authError } = await authClient.signIn.email({
      email: email.value,
      password: password.value,
    });

    if (authError) {
      error.value = authError.message ?? null;
    } else {
      router.push("/");
    }
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div>
    <h1>Sign In</h1>
    <form @submit.prevent="handleSignIn">
      <div>
        <label>
          Email
          <input v-model="email" type="email" required />
        </label>
      </div>
      <div>
        <label>
          Password
          <input v-model="password" type="password" required />
        </label>
      </div>
      <button type="submit" :disabled="loading">
        {{ loading ? "Signing in..." : "Sign In" }}
      </button>
    </form>
    <p v-if="error">{{ error }}</p>
    <p>
      Don't have an account?
      <NuxtLink to="/signup">Sign Up</NuxtLink>
    </p>
  </div>
</template>
