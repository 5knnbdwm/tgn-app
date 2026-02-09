// @ts-check
import withNuxt from "./.nuxt/eslint.config.mjs";

export default withNuxt(
  {
    ignores: ["convex/_generated/**"],
  },
  {
    rules: {
      "vue/multi-word-component-names": "off",
      "vue/html-self-closing": "off",
    },
  },
);
