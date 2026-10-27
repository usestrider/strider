// The `reference` collection: one entry per documented module, from the dataset's manifests. An entry holds only
// what navigation needs; a module's page loads its TypeDoc JSON when it renders, as effect.website's loader does, so
// the 40 MB of JSON never enters Astro's data store.
import type { Loader } from "astro/loaders"
import { z } from "astro/zod"
import * as path from "node:path"
import { datasetRoot, manifests } from "./dataset.ts"
import { sectionOf, sectionOrder } from "./sections.ts"

export const referenceSchema = z.object({
  /** `@usestrider/browser` */
  packageName: z.string(),
  /** `browser`: the package's name without its scope, as its routes use it */
  slug: z.string(),
  version: z.string(),
  revision: z.string(),
  repository: z.string().nullable(),
  categoryOrder: z.array(z.string()),
  /** `@usestrider/browser/chromium/Chromium` */
  module: z.string(),
  /** `./chromium/Chromium` */
  export: z.string(),
  /** `chromium/Chromium`: the module's route under its package */
  path: z.string(),
  /** `Chromium` */
  name: z.string(),
  /** `src/chromium/Chromium.ts`, relative to the package */
  source: z.string(),
  /** The module's TypeDoc JSON, and its hash */
  file: z.string(),
  sha256: z.string(),
  barrel: z.string().nullable(),
  section: z.string(),
  sectionIndex: z.number()
})

export const referenceLoader = (): Loader => ({
  name: "strider-reference",
  schema: referenceSchema,
  load: async ({ store, parseData, generateDigest, logger, watcher }) => {
    const sync = async () => {
      store.clear()
      let count = 0
      for (const { directory, manifest } of manifests()) {
        const slug = manifest.package.replace(/^@[^/]+\//, "")
        for (const module of manifest.modules) {
          const modulePath = module.export.replace(/^\.\//, "")
          const section = sectionOf(manifest.package, module.export)
          const id = `${slug}/${modulePath}`
          const data = await parseData({
            id,
            data: {
              packageName: manifest.package,
              slug,
              version: manifest.version,
              revision: manifest.revision,
              repository: manifest.repository,
              categoryOrder: [...manifest.categoryOrder],
              module: module.module,
              export: module.export,
              path: modulePath,
              name: modulePath.split("/").at(-1)!,
              source: module.source,
              file: path.join(directory, module.json),
              sha256: module.sha256,
              barrel: module.barrel,
              section,
              sectionIndex: sectionOrder.indexOf(section)
            }
          })
          store.set({ id, data, digest: generateDigest(`${manifest.revision}:${module.sha256}`) })
          count++
        }
      }
      logger.info(`${count} modules`)
    }
    await sync()
    // `pnpm api-reference` while `astro dev` runs reloads the reference. It removes each package's directory and
    // writes it again, manifest last, so the dataset's root is watched, which outlives that, and a manifest written
    // under it, added or changed, syncs the store.
    const root = datasetRoot()
    watcher?.add(root)
    for (const event of ["add", "change"] as const) {
      watcher?.on(event, (changed) => {
        if (path.basename(changed) === "manifest.json" && changed.startsWith(root)) void sync()
      })
    }
  }
})
