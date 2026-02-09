import type { VariantProps } from "class-variance-authority";
import { cva } from "class-variance-authority";

export { default as Label } from "./Label.vue";

export const labelVariants = cva(
  "flex items-center gap-2 leading-none select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "text-sm font-medium",
        auth: "mt-2 text-[0.77rem] font-bold tracking-[0.06em] uppercase text-[#4d463f]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export type LabelVariants = VariantProps<typeof labelVariants>;
