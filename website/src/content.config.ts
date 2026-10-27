import { glob } from "astro/loaders"
import { z } from "astro/zod"
import { defineCollection } from "astro:content"
import { referenceLoader } from "./features/reference/loader.ts"

// Guides: MDX, grouped in the navigation by directory (src/features/docs/navigation.ts)
const docs = defineCollection({
  loader: glob({ base: "./src/content/docs", pattern: "**/[^_]*.{md,mdx}" }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    /** Where the page comes in its group */
    order: z.number().default(0)
  })
})

// The API reference, generated from the packages
const reference = defineCollection({ loader: referenceLoader() })

export const collections = { docs, reference }
