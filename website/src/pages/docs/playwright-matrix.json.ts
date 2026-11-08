import browsers from "../../features/playwright/browsers.json"
import matrix from "../../features/playwright/matrix.json"
import upstream from "../../features/playwright/upstream.json"

export const GET = () =>
  new Response(JSON.stringify({ matrix, upstream, browsers }), {
    headers: { "Content-Type": "application/json" }
  })
