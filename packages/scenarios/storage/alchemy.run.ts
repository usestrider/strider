// The private R2 bucket that holds the scenarios' site recordings, each under its SHA-256 (src/recordings.ts), in its
// own stack so deploying the docs never touches it. `alchemy deploy --stage prod` from this directory deploys it with
// the maintainer's Cloudflare credentials; the bucket has no public access and no domain.
import * as Cloudflare from "@alchemy.run/cloudflare"
import * as Alchemy from "alchemy"
import * as Effect from "effect/Effect"

export default Alchemy.Stack(
  "StriderRecordings",
  { providers: Cloudflare.providers(), state: Cloudflare.state() },
  Effect.gen(function*() {
    const bucket = yield* Cloudflare.R2.Bucket("Recordings", {
      // Fixed, so a lost state adopts this bucket rather than making another; src/recordings.ts reads the name from
      // STRIDER_RECORDINGS_BUCKET
      name: "strider-recordings",
      publicAccess: false
    })
    return { bucket: bucket.bucketName }
  })
)
