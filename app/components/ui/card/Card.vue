<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import type { CardVariants } from "."
import { cn } from "@/lib/utils"
import { cardVariants } from "."

const props = defineProps<{
  variant?: CardVariants["variant"]
  class?: HTMLAttributes["class"]
}>()
</script>

<template>
  <div
    data-slot="card"
    :class="
      cn(
        cardVariants({ variant }),
        props.class,
      )
    "
  >
    <slot />
  </div>
</template>
