import tailwindcss from "@tailwindcss/vite";

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: "2025-07-15",
  devtools: { enabled: true },

  runtimeConfig: {
    pipelineServiceUrl: process.env.NUXT_PIPELINE_SERVICE_URL ?? "",
    pipelineServiceApiKey: process.env.NUXT_PIPELINE_SERVICE_API_KEY ?? "",
    pipelineProxyApiKey: process.env.NUXT_PIPELINE_PROXY_API_KEY ?? "",
    pdfServiceApiKey: process.env.NUXT_PDF_SERVICE_API_KEY ?? "",
  },

  modules: [
    "@nuxt/eslint",
    "@nuxt/hints",
    "@nuxt/icon",
    "@nuxt/image",
    "better-convex-nuxt",
    "shadcn-nuxt",
    "@vueuse/nuxt",
    "@nuxtjs/color-mode",
  ],

  convex: {
    url: process.env.CONVEX_URL,
    permissions: true,
  },

  css: ["./app/assets/css/main.css"],

  vite: {
    plugins: [tailwindcss()],
  },

  shadcn: {
    prefix: "",
    componentDir: "@/components/ui",
  },
  colorMode: {
    classSuffix: "",
  },
  nitro: {
    preset: "bun",
  },
});
