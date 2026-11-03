// Every page the build wrote, twice from one list: sitemap.xml for search engines, kept strictly to the format, and
// /sitemap/ for a person, with links, which an XML file can't have from CSS alone. Their URLs are the ones the host
// serves, with a trailing slash, since it redirects to that, and a sitemap should list no redirects
import type { AstroIntegration } from "astro"
import { mkdir, writeFile } from "node:fs/promises"

const xml = (site: string, paths: ReadonlyArray<string>) =>
  `<?xml version="1.0" encoding="UTF-8"?>
<?xml-stylesheet type="text/css" href="/sitemap.css"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${paths.map((path) => `  <url><loc>${new URL(path, site).href}</loc></url>`).join("\n")}
</urlset>
`

const html = (paths: ReadonlyArray<string>) =>
  `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Sitemap · Strider</title>
    <meta name="description" content="Every page of Strider's documentation site." />
    <link rel="icon" href="/heron.svg" type="image/svg+xml" />
    <link rel="stylesheet" href="/sitemap.css" />
  </head>
  <body>
    <header>
      <h1>Sitemap</h1>
      <p>${paths.length} pages of <a href="/">usestrider.dev</a>.</p>
    </header>
    <ol>
${paths.map((path) => `      <li><a href="${path}">${path}</a></li>`).join("\n")}
    </ol>
  </body>
</html>
`

export const sitemap = (site: string): AstroIntegration => ({
  name: "strider:sitemap",
  hooks: {
    "astro:build:done": async ({ dir, logger, pages }) => {
      // The build's pages include its endpoints, such as the stylesheet, which aren't pages to a reader
      const paths = pages
        .map(({ pathname }) => pathname)
        .filter((pathname) => !/\.\w+\/?$/.test(pathname))
        .map((pathname) => `/${pathname}`.replace(/\/*$/, "/"))
        .concat("/sitemap/")
        .sort()
      await writeFile(new URL("sitemap.xml", dir), xml(site, paths))
      await mkdir(new URL("sitemap/", dir), { recursive: true })
      await writeFile(new URL("sitemap/index.html", dir), html(paths))
      logger.info(`sitemap: ${paths.length} pages`)
    }
  }
})
