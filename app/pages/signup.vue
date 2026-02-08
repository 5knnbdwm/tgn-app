<script setup lang="ts">
const router = useRouter();
const authClient = useAuthClient();
const { isAuthenticated } = useConvexAuth();

const name = ref("");
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

async function handleSignUp() {
  if (!authClient) return;

  error.value = null;
  loading.value = true;

  try {
    const { error: authError } = await authClient.signUp.email({
      name: name.value,
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
    <h1>Sign Up</h1>
    <form @submit.prevent="handleSignUp">
      <div>
        <label>
          Name
          <input v-model="name" type="text" required />
        </label>
      </div>
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
        {{ loading ? "Signing up..." : "Sign Up" }}
      </button>
    </form>
    <p v-if="error">{{ error }}</p>
    <p>
      Already have an account?
      <NuxtLink to="/signin">Sign In</NuxtLink>
    </p>
  </div>
</template>
