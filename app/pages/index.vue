<script setup lang="ts">
import { api } from "~~/convex/_generated/api";
import type { Id } from "~~/convex/_generated/dataModel";

definePageMeta({ middleware: "auth" });

const {
  results: publications,
  status,
  loadMore,
  isLoading,
} = useConvexPaginatedQuery(
  api.publications.publicationQueries.listPublications,
  {},
  { initialNumItems: 2 },
);

const { upload, pending, error } = useConvexFileUpload(
  api.files.generateUploadUrl,
  {
    allowedTypes: ["application/pdf"],
    maxSize: 10 * 1024 * 1024,
  },
);
const { mutate: createPublication } = useConvexMutation(
  api.publications.publicationMutations.createPublicationUpload,
);

async function onInputChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = input.files;
  if (!files) return;
  for await (const file of files) {
    if (file.type !== "application/pdf") continue;
    try {
      const id = await upload(file);

      await createPublication({
        fileStorageId: id as Id<"_storage">,
        fileName: file.name,
      });

      console.log("Uploaded:", id);
    } catch {
      console.error(error);
    }
  }

  input.value = "";
}

// const colorMode = useColorMode();
</script>

<template>
  <div>
    <input
      type="file"
      accept="application/pdf"
      :disabled="pending"
      multiple
      @change="onInputChange"
    />
    <hr />
    <h1>Publications</h1>
    <div v-for="publication in publications" :key="publication._id">
      <h2>{{ publication.name }} {{ publication.status }}</h2>
      <!-- <p>{{ publication.status }}</p>
      <p>{{ publication.sourceType }}</p>
      <p>{{ publication.publicationFileStorageId }}</p>
      <p>{{ publication.publicationFileMimeType }}</p> -->
    </div>
    <Button
      v-if="status === 'CanLoadMore'"
      :disabled="isLoading"
      @click="loadMore(2)"
    >
      Load More
    </Button>

    <p v-if="status === 'Exhausted'">No more messages</p>
  </div>
</template>
