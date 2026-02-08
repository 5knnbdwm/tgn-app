<script setup lang="ts">
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const router = useRouter();
const authClient = useAuthClient();
const { isAuthenticated } = useConvexAuth();

const email = ref("");
const password = ref("");
const error = ref<string | null>(null);
const loading = ref(false);
const showPassword = ref(false);

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
      error.value = authError.message ?? "Unable to sign in";
      return;
    }

    router.push("/");
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <main
    class="grid min-h-dvh place-items-center p-4 text-[#1d1b19] sm:p-5 lg:p-10 bg-[radial-gradient(circle_at_16%_14%,#f8b77f_0%,transparent_32%),radial-gradient(circle_at_86%_84%,#e5c58f_0%,transparent_30%),linear-gradient(140deg,#f4efe4_0%,#f6d9ac_46%,#f8f3eb_100%)]"
  >
    <div class="w-full max-w-[560px] overflow-hidden rounded-[28px] shadow-[0_28px_64px_rgba(71,55,30,0.18),0_2px_6px_rgba(58,41,13,0.08)]">
      <Card
        variant="auth"
        class="grid content-center gap-5 border-0 p-7 sm:p-9 lg:p-10"
      >
        <CardHeader class="gap-1 p-0">
          <p class="font-serif text-[clamp(2.2rem,6vw,3.4rem)] leading-[0.98] text-[#2d2925]">
            TGN Research
          </p>
          <CardTitle class="m-0 text-sm font-bold uppercase tracking-[0.14em] text-[#5a544c]">
            Sign In
          </CardTitle>
          <CardDescription class="m-0 pt-0.5 leading-relaxed text-[#5a544c]">
            Use your account credentials to access your dashboard.
          </CardDescription>
        </CardHeader>

        <CardContent>
          <form class="grid gap-3" @submit.prevent="handleSignIn">
            <Label for="email" variant="auth">Email</Label>
            <Input
              id="email"
              v-model="email"
              variant="auth"
              type="email"
              autocomplete="email"
              placeholder="you@company.com"
              required
            />

            <Label for="password" variant="auth">Password</Label>
            <div class="relative">
              <Input
                id="password"
                v-model="password"
                variant="auth"
                :type="showPassword ? 'text' : 'password'"
                autocomplete="current-password"
                placeholder="Enter your password"
                class="pr-[4.5rem]"
                required
              />
              <button
                type="button"
                class="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer rounded-[0.6rem] border-0 bg-[rgba(66,56,45,0.08)] px-2.5 py-1.5 text-[0.76rem] font-bold text-[#413529] hover:bg-[rgba(66,56,45,0.16)]"
                :aria-label="showPassword ? 'Hide password' : 'Show password'"
                @click="showPassword = !showPassword"
              >
                {{ showPassword ? "Hide" : "Show" }}
              </button>
            </div>

            <p
              v-if="error"
              role="alert"
              class="my-1 rounded-xl border border-[rgba(153,34,34,0.25)] bg-[rgba(255,236,236,0.8)] px-3.5 py-3 text-[0.92rem] text-[#8f2727]"
            >
              {{ error }}
            </p>

            <Button
              type="submit"
              variant="auth"
              size="lg"
              :disabled="loading"
              class="mt-3 h-auto py-3.5 text-[0.95rem]"
            >
              {{ loading ? "Signing in..." : "Sign In" }}
            </Button>
          </form>

        </CardContent>
      </Card>
    </div>
  </main>
</template>
