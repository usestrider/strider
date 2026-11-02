---
"@usestrider/browser": minor
---

Make Route, pending dialog and file chooser decisions return Effects. This is a breaking API change: replace `() => Effect.succeed(Route.abort())` with `() => Route.abort()`, and return pending decisions such as `dialog.accept`, `dialog.respond(text)`, `chooser.select(files)` and `chooser.cancel` directly. In generators, replace `return Route.abort()` (or a pending decision) with `return yield* Route.abort()`. Replace `Effect.as(decision)` with `Effect.andThen(decision)`, and `Effect.map(work, () => decision)` with `Effect.flatMap(work, () => decision)`. Handlers still require an Effect, and Route decisions keep their phase restrictions. `Dialog.acceptAll`, `Dialog.dismissAll` and `FileChooser.choose` remain ready-to-use handlers.
