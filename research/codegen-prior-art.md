# Codegen prior art: Alchemy's distilled and Effect's OpenAPI generator

Sources:
- `github.com/alchemy-run/distilled` at `a65178c` (2026-10-14), a read-only clone at `/tmp/prior-art/distilled`. Files read:
  - `.agents/skills/distilled-sdk{,-patch,-update}/SKILL.md`;
  - `packages/core/src/codegen/{emit,generator,patches,model-diff}.ts`;
  - `packages/core/src/{trait,api,response-validation}.ts`;
  - `benches/{typecheck,bundle}/README.md`;
  - the generated `packages/neon/src/services/neon.ts`.
- The `@effect/openapi-generator@4.0.5` tarball (`/tmp/prior-art/effect-openapi-generator/package/src`): `main.ts`, `OpenApiPatch.ts`, `JsonSchemaGenerator.ts`, `OpenApiGenerator.ts`, `OpenApiTransformer.ts`.
- `effect@4.0.5`: `JsonPatch.ts`, `SchemaRepresentation.ts`, `internal/schema/toCodeDocument.ts`.

Every claim here was **read** from source; nothing was run. The decision these notes fed is PROTOCOL.md, Code generation (revision 5.16).

## Summary

- **Both confirm the route.** Distilled is the "own emitter over a model" architecture at the scale of 89 providers. Effect's OpenAPI generator is the `toCodeDocument` route in practice, and it shows that route's limits: no hooks, no brands, no PURE annotations.
- **Adopted:**
  - a committed, name-keyed model and committed output;
  - corrections as patches that cite evidence, fail when stale and are audited on each update;
  - our own annotations in a separate overlay;
  - a coverage report;
  - hand-emitted interfaces with cast codecs;
  - PURE annotations everywhere;
  - `Redacted` sensitive members;
  - Effect's `JsonPatch`;
  - declarative error matchers (revision 5.17).
- **Recorded, not yet adopted:**
  - a validation mode set through one `Context.Reference`;
  - testing the generator once instead of the generated code (for the testing discussion).
- **Not copied:**
  - closed enum types on outputs;
  - Smithy as the model format;
  - mirror repositories;
  - operation renaming;
  - per-operation request code.

## Alchemy's distilled

The `@distilled.cloud/*` packages (version 1.0.0-rc.15) are Effect SDKs for 89 providers. The pipeline:

1. The upstream description is fetched into a `spec-mirror-<pkg>` repository, refetched daily. The fetch validates the response and writes it deterministically.
2. `convert.ts` turns each dialect into Smithy 2.0 JSON. The dialects are OpenAPI, GraphQL, Google discovery documents, protobuf and Cloudflare's docs markdown.
3. RFC 6902 patches are applied in `finalizeConvert`.
4. Operations are renamed to verbNoun.
5. The result is committed as `.generated-specs/`.
6. A generic generator, configured per provider by an `SdkSpec`, writes `src/services/*.ts`. That output is committed and formatted.

### Adopted

1. **Committed model and output.**
   - CI never regenerates and never checks out a spec. Whoever regenerates commits the gitlink that pins the spec, so the generation can be reproduced.
   - "Never diff regeneration results before formatting."
   - A spec update's PR names renamed and removed operations, nullability flips, and the operation count before and after.
2. **Patches are claims, with evidence.**
   - Patches target the model. Convert rejects an operation aimed at the raw spec (`/paths`, `/components`).
   - A patch's `description` says what the spec gets wrong, what the wire does, and where that was seen, with a date for live probes. It is the bug report sent upstream.
   - "A patch built from reading the spec alone guesses at the wire"; "a probe that never reached the code path proves nothing."
   - Stale pointers fail the run. When they used to warn and skip, Fly's whole patch chain silently vanished after the mirror prefixed its paths with `/v1`.
   - `finalizeConvert` isn't idempotent: it stamps `distilled.finalized` and refuses a model that already carries it.
3. **The audit.**
   - It builds the model once with every patch, then once per patch with that patch left out, and diffs the results.
   - Verdicts: *no effect* (delete it), *needed* (the diff is the patch's description, mechanically), or *the build fails without it* (a later patch depends on it).
   - Verdicts are one at a time. Two patches that add the same thing each look unused alone, so delete, regenerate and audit again until the list is empty.
   - Typed patch configs (AWS's) can't be audited.
   - All of Cloudflare, about 2,850 patch files, audits in under two minutes.
4. **Name-keyed pointers.** Every pointer is `/shapes/<namespace>#<Shape>/…`. That is what keeps pointers stable across spec updates. CDP's JSON uses arrays whose indexes shift on every roll.
5. **Compile-time cost.**
   - The emission pattern (from distilled PR #360) is `export interface X {…}` plus `export const X = S.suspend(() => S.Struct({…})).annotate({ identifier: "X" }) as any as S.Codec<X>`, so the compiler never infers types from schema generics. Shapes are emitted in topological order.
   - Recorded typecheck numbers (TypeScript 7, 16 cores):
     - AWS: 6.5 s and 4.9 GiB to emit, 17.5 s and 10.3 GiB to check.
     - Cloudflare: 18.2 s to check. Its per-file cost comes from deep `Schema` compositions, not volume.
     - The full monorepo check needs about a 12 GiB machine. `noCheck` is about 2.5 times faster.
6. **Bundle size.**
   - Tree-shaking at service level works: S3 keeps 1 of its 112 operations.
   - Two things survive tree-shaking even with PURE annotations: `class X extends f(…)`, and calls nested as unannotated arguments. The fix is a `/*@__PURE__*/ const` that the class then extends.
7. **Sensitive members.**
   - Convert marks names matching default patterns (`password`, `api_token`, …), and patches add the rest. Marked members become `Redacted`.
   - Credential inputs accept `Redacted<string>` only, never `string | Redacted`, and a grep check enforces it.
8. **Generated code is data.** Traits are Schema annotations (`Http`, `Label`, `Query`, …) that a generic `Protocol` service reads off the AST at encode and decode time. Our commands and events follow the same idea: method, codecs and traits, with behavior in the hand-written client.

### Recorded, not yet adopted

9. **Validation mode as one reference.**
   - `ResponseValidation` is one `Context.Reference` shared by every SDK. It defaults to lenient, is switched to strict only by providing a Layer (never an environment variable), and can be nested per call.
   - Our policy (decode by default, `trust` as an opt-in layer) can use the same mechanism.
   - Their lenient default exists because their specs are unreliable. Ours stays `decode`, because L1's state tracking needs correct data.
10. **Declarative error matchers** (adopted in revision 5.17).
    - A matcher is `{ code, status, message: string | { includes, matches }, body: { pointer: value }, headers }`. All its fields must match, and separate matchers are alternatives. The most specific match wins (one point per field), with ties broken by declaration order.
    - Rule: every error class must be one the protocol can actually raise. About 75 packages had declared a `ParseError` that no code path constructed.
    - Adopted as L0's per-backend matcher tables (PROTOCOL.md, Protocol client), with one difference: distilled's matchers pick among many generated classes per operation, while ours map onto L0's small fixed set of tags, with a normalized `RejectReason`. Their rule carries over as "a `RejectReason` that no table produces is removed."
11. **Testing.**
    - Generated code isn't tested per package. The generator and the protocols are tested once, in `core`.
    - One test, `sdks.test.ts`, runs over every package and checks only the hand-written glue.
    - This is for the testing discussion.
12. **`OperationMethod`.** It is both callable and yieldable: `const call = yield* op` captures the current context and returns a call function with no requirements. Not adopted: principle 22 (one way to do each thing), and `Protocol.on(session)` already covers it.

### Not copied

- **Closed enum types on outputs.** Outputs are typed as the closed list of documented values while the schema is `S.String`, so an undocumented value arrives typed as a documented one. Inputs reopen the type as `X | (string & {})`. We keep enums open in both directions, because L1 switches on these values.
- **Smithy as the model format.** The generator is HTTP-bound (`Http`, `Label`, `Query`, `Header`), so it can't be reused. Events, sessions and BiDi's three kinds of union would all need custom traits. We borrow the layout: shapes keyed by id, with traits as a map.
- **Mirror repositories.** They solve upstreams measured in gigabytes; GitHub's description repository is 6.7 GB for one 13 MB file. Our inputs are small enough to vendor.
- **Operation renaming.** CDP and BiDi names are already `Domain.method`.

## Effect's OpenAPI generator

`@effect/openapi-generator` 4.0.5 is about 4.7k lines. Its CLI is `openapigen --spec … --format httpclient | httpclient-type-only | httpapi --patch …`, and it prints one source file to stdout.

1. **The `toCodeDocument` route, in practice.**
   - `JsonSchemaGenerator` normalizes OpenAPI 3.0 and 3.1 into Effect's JSON Schema model. Then `SchemaRepresentation` produces a document, and `toCodeDocument(document)`, which takes no options, renders it.
   - Customization happens only before rendering (an `onEnter` hook that rewrites JSON Schema nodes) or after it (replacing a whole `Code` entry by `$ref`, which is how multipart file types are substituted).
   - Effect's own docs: "TypeScript-only distinctions such as those added by `Schema.brand` are absent from the AST and cannot be reconstructed."
   - The output has no PURE annotations. Each `export type X` is explicit, but `export const X = …` is inferred from the schema expression. Recursion uses `Schema.suspend((): Schema.Codec<X> => X)`.
   - Swapping entries by name works for a handful, but not for hundreds of id brands and CDP's inline enums.
2. **Patches through `effect/JsonPatch`.**
   - Patches are applied to the spec before generation, in CLI order, from JSON, YAML or inline input.
   - `JsonPatch` supports only `add`, `remove` and `replace`, the subset that applies deterministically; there is no `move`, `copy` or `test`.
   - Each operation has an optional `description`.
   - It throws on missing paths and out-of-range indexes, so stale pointers fail. It never mutates its input.
   - `JsonPatch.get(old, new)` computes a diff, which the audit needs.
   - We patch the model rather than the spec, as distilled does. BiDi's CDDL isn't JSON, and this gives one pointer language across three backends.
3. **Coded warnings for anything lossy.** Each warning carries an operation context and is printed to stderr:
   - `naming-collision`
   - `additional-tags-dropped`
   - `cookie-parameter-dropped`
   - `no-body-method-request-body-skipped`
   - `sse-operation-skipped`
   - `optional-request-body-approximated`
   - `default-response-remapped`
   - `response-headers-ignored`
   - `security-and-downgraded`

   This became our committed coverage report. It fits principle 23: nothing is dropped silently.
4. **One parse, two renderers.** Schema-backed and types-only output come from the same parsed model, selected by providing a different transformer Layer.
5. **Per-operation request code.** `make(httpClient)` returns methods whose request pipelines are written inline, one per operation. That suits an HTTP client, but a behavior change then needs a regeneration. We emit data instead.
