// How /sitemap/ and sitemap.xml look to a person: the site's band, type and rules. CSS can't make an XML element a link,
// so sitemap.xml's URLs are text, and it says where the links are. An endpoint, so it can name the site's hashed fonts
import type { APIRoute } from "astro"
import { type CssVariable, fontData } from "astro:assets"

const faces = (family: string, cssVariable: CssVariable) =>
  fontData[cssVariable].map(({ src, style, weight }) =>
    `@font-face {
  font-family: "${family}";
  src: ${src.map(({ format, url }) => `url("${url}") format("${format}")`).join(", ")};
  font-style: ${style};
  font-weight: ${weight};
}`
  )

const css = `${
  [
    ...faces("EB Garamond", "--font-garamond"),
    ...faces("IBM Plex Sans", "--font-plex-sans"),
    ...faces("IBM Plex Mono", "--font-plex")
  ].join("\n")
}

:root {
  color-scheme: light dark;
  --paper: #fbfaf6;
  --ink: #1a1a1a;
  --labels: #5a5750;
  --hairline: #e2ded3;
  --band: #1558c8;
  --band-text: #1558c8;
  --gutter: max(1.5rem, calc(50% - 26rem));
  --title: 400 3.8rem/1.08 "EB Garamond", Garamond, Georgia, serif;
  --mono: 400 0.9rem/1.5 "IBM Plex Mono", ui-monospace, SFMono-Regular, monospace;
  display: block;
  min-height: 100vh;
  background: var(--paper);
  color: var(--ink);
}
@media (prefers-color-scheme: dark) {
  :root {
    --paper: #201f1c;
    --ink: #f2eee6;
    --labels: #aca69a;
    --hairline: #3b3934;
    --band-text: #5988d8;
  }
}
body {
  margin: 0;
}
header,
urlset::before {
  display: block;
  margin-bottom: 1.5rem;
  padding: 2.5rem var(--gutter) 2rem;
  background: var(--band);
  color: #fff;
}
h1,
urlset::before {
  font: var(--title);
}
h1 {
  margin: 0;
}
header p {
  margin: 0.75rem 0 0;
  font: 400 0.95rem/1.5 "IBM Plex Sans", ui-sans-serif, system-ui, sans-serif;
}
header a {
  color: inherit;
}
ol {
  margin: 0 0 3rem;
  padding: 0 var(--gutter);
  list-style: none;
}
li {
  border-bottom: 1px solid var(--hairline);
}
li a {
  display: block;
  padding: 0.35rem 0;
  color: var(--band-text);
  font: var(--mono);
  overflow-wrap: anywhere;
  text-decoration: none;
}
li a:hover {
  text-decoration: underline;
}
/* sitemap.xml */
urlset::before {
  content: "Sitemap";
}
url {
  display: block;
  width: min(52rem, 100% - 3rem);
  margin-inline: auto;
  border-bottom: 1px solid var(--hairline);
}
url:first-of-type::before {
  content: "For search engines. To browse, open usestrider.dev/sitemap/";
  display: block;
  padding-bottom: 0.3rem;
  border-bottom: 1px solid var(--ink);
  color: var(--labels);
  font: 400 0.95rem/1.5 "IBM Plex Sans", ui-sans-serif, system-ui, sans-serif;
}
url:last-of-type {
  margin-bottom: 3rem;
}
loc {
  display: block;
  padding: 0.35rem 0;
  font: var(--mono);
  overflow-wrap: anywhere;
}
`

export const GET: APIRoute = () => new Response(css, { headers: { "Content-Type": "text/css; charset=utf-8" } })
