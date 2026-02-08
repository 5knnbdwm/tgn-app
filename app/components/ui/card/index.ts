import type { VariantProps } from "class-variance-authority"
import { cva } from "class-variance-authority"

export { default as Card } from "./Card.vue"
export { default as CardAction } from "./CardAction.vue"
export { default as CardContent } from "./CardContent.vue"
export { default as CardDescription } from "./CardDescription.vue"
export { default as CardFooter } from "./CardFooter.vue"
export { default as CardHeader } from "./CardHeader.vue"
export { default as CardTitle } from "./CardTitle.vue"

export const cardVariants = cva(
  "text-card-foreground flex flex-col gap-6 border",
  {
    variants: {
      variant: {
        default: "bg-card rounded-xl py-6 shadow-sm",
        auth: "bg-white/78 rounded-none py-6 shadow-none backdrop-blur-[4px] border-l border-[#36312a1f]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
)

export type CardVariants = VariantProps<typeof cardVariants>
