import type { VariantProps } from "class-variance-authority";
import { cva } from "class-variance-authority";

export { default as Input } from "./Input.vue";

export const inputVariants = cva(
  "file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground dark:bg-input/30 border-input w-full min-w-0 border bg-transparent text-base shadow-xs transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default: "h-9 rounded-md px-3 py-1",
        auth: "h-11 rounded-xl border-[#4b433939] bg-white/85 px-3.5 py-2 text-[0.95rem] text-[#1d1b19] placeholder:text-[#8a8177] shadow-none focus-visible:border-[#bf4b2c] focus-visible:ring-[#bf4b2c]/20",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export type InputVariants = VariantProps<typeof inputVariants>;
