// A sitemap of every page the build wrote. Its URLs are the ones the host serves, with a trailing slash, since it
// redirects to that, and a sitemap should list no redirects
import type { AstroIntegration } from "astro"
import { writeFile } from "node:fs/promises"

export const sitemap = (site: string): AstroIntegration => ({
  name: "strider:sitemap",
  hooks: {
    "astro:build:done": async ({ dir, logger, pages }) => {
      const urls = pages.map(({ pathname }) => new URL(`/${pathname}`.replace(/\/?$/, "/"), site).href).sort()
      const entries = urls.map((url) => `  <url><loc>${url}</loc></url>`).join("\n")
      await writeFile(
        new URL("sitemap.xml", dir),
        `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>\n`
      )
      logger.info(`sitemap.xml: ${urls.length} pages`)
    }
  }
})
