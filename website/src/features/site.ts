// What the site says about itself: the package's version, as the masthead and the cover show it
import { getCollection } from "astro:content"

/** `v0.4.2`, or `pre-release` before the package's first version */
export const versionLabel = async () => {
  const entry = (await getCollection("reference")).find((e) => e.data.packageName === "@usestrider/browser")
  const version = entry?.data.version
  return version === undefined || version === "0.0.0" ? "pre-release" : `v${version}`
}

/** Where a guide's source is edited on GitHub */
export const editUrl = (filePath: string | undefined) =>
  filePath === undefined
    ? undefined
    : `https://github.com/usestrider/strider/edit/main/website/${filePath.replace(/^\.?\//, "")}`
