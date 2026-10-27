# Design review: storage partitions by origin

*2026-10-26. Review of commit `5b208c2` (review 23's last step) on storage state. Prompted by QUIRKS.md, Q232, which review 23's third step found: stock WebKit keys a cross-site frame's storage by the top-level origin, port included, and a storage state records a partition by its top-level site. The maintainer asked what I would propose, and agreed to it ("fine") before this was written.*

## What the browsers do

Probed against WebKitGTK 2.54.1's MiniBrowser, launched as the integration tests launch it, with a throwaway test (not kept):

| Probe | Stock WebKit |
|---|---|
| **P1.** A cross-site frame's `localStorage`, written under a page at `http://127.0.0.1:39051`, then a storage state exported and restored into a new context | Exported under its site, `http://127.0.0.1`; restored from a page the library's route serves at `http://127.0.0.1/…`, port 80 |
| **P2.** The restored frame under a page at `http://127.0.0.1:39051` | Its storage is empty |
| **P3.** The restored frame under a page at `http://127.0.0.1` (port 80, served by a route) | Its storage has the value |

Chromium and Firefox key a partition by the top-level site, which has no port, so a partition restored at any port of the site is the one a page at another finds (the slices' call site 1 passes on both, at the test server's port).

## Candidates

### 1. The top-level origin beside the site

**Where:** `StorageState.OriginState` (`src/StorageState.ts`).

- **`topLevelOrigin?: Url.Origin`**, an optional key beside `partition`: for a partitioned origin, the origin of the top-level document it was read under. A state saved before has no such key, and decodes as it did.
- **Not in `CookieJar.PartitionKey`,** which cookies share: a cookie's partition is the top-level site on every backend that reports one (Chromium), and stays so.

**Recommendation.** Adopt.

### 2. Export and restore

**Where:** `src/internal/storageState.ts`.

- **Export** records, for each partitioned origin, the origin of the page it was read under. An origin is still read once per top-level site: where two top-level origins of one site show it, the first page's is recorded. On Chromium and Firefox that's the one partition; on stock WebKit the other's storage isn't read, as now.
- **Restore** writes a partitioned origin's storage from a frame of a page at its `topLevelOrigin`, or, where a state has none, at its top-level site, the scheme's default port, as now. Writing at the origin is right on every backend: the origin is of the site.

**Recommendation.** Adopt.

### 3. Capability and tests

- **`storageState.partitioned`** is `supported` on stock WebKit, with one limitation: a state with no top-level origin is restored at its site's default port.
- **The slices' call site 1** checks the restored frame's storage on every backend again, and a standard test decodes a state saved without the key.

**Recommendation.** Adopt.

## Considered and not adopted

- **One origin entry per top-level origin,** on every backend: Chromium and Firefox would export the same partition twice, under each origin of its site, and restore it twice.
- **Leaving the limitation as Q232 left it:** a restore at another port reports success and writes where no page will look.
- **The port in `topLevelSite`:** a site has no port, by its definition and by Chromium's.

## Build

In one step, committed and pushed when its tests pass: the schema, export and restore, the capability, the tests, and the documents, with QUIRKS.md's Q232 marked.

## Decision

Adopted, 2026-10-26, as recommended: the maintainer agreed to the proposal this records ("fine"), to be built after review 23's last step.
