// As effect.website builds its site: Astro with MDX, Expressive Code, the remark processor, Tailwind and Fontsource
import { rehypeHeadingIds, unified } from "@astrojs/markdown-remark"
import mdx from "@astrojs/mdx"
import tailwindcss from "@tailwindcss/vite"
import expressiveCode from "astro-expressive-code"
import { defineConfig, fontProviders } from "astro/config"
import { fileURLToPath } from "node:url"

// The API reference dataset, which `pnpm reference` writes at the repository's root
process.env["STRIDER_REFERENCE_DATA"] ??= fileURLToPath(new URL("../.data/api-reference/", import.meta.url))

export default defineConfig({
  trailingSlash: "never",
  devToolbar: { enabled: false },
  markdown: {
    processor: unified({ rehypePlugins: [rehypeHeadingIds] })
  },
  integrations: [expressiveCode(), mdx()],
  // Self-hosted from Fontsource, as effect.website hosts its fonts: EB Garamond for titles, Source Serif 4 for reading,
  // IBM Plex Sans for navigation and labels, and IBM Plex Mono for code
  fonts: [
    {
      provider: fontProviders.fontsource(),
      name: "EB Garamond",
      weights: ["400 600"],
      styles: ["normal", "italic"],
      cssVariable: "--font-garamond",
      fallbacks: ["Garamond", "Georgia", "serif"]
    },
    {
      provider: fontProviders.fontsource(),
      name: "Source Serif 4",
      weights: ["400", "600"],
      styles: ["normal", "italic"],
      cssVariable: "--font-source-serif",
      fallbacks: ["Georgia", "serif"]
    },
    {
      provider: fontProviders.fontsource(),
      name: "IBM Plex Sans",
      weights: ["400", "500", "600"],
      styles: ["normal"],
      cssVariable: "--font-plex-sans",
      fallbacks: ["ui-sans-serif", "system-ui", "sans-serif"]
    },
    {
      provider: fontProviders.fontsource(),
      name: "IBM Plex Mono",
      weights: ["400", "500"],
      styles: ["normal"],
      cssVariable: "--font-plex",
      fallbacks: ["ui-monospace", "SFMono-Regular", "monospace"]
    }
  ],
  vite: {
    plugins: [tailwindcss()]
  }
})
