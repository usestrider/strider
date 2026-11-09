/** Native HTTP accounting, invoked only for contexts that opt into sizes. */
import * as Option from "effect/Option"
import { Sizes } from "../NetworkRequest.ts"

export const count = (value: number | null | undefined): Option.Option<number> =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? Option.some(value) : Option.none()
export const empty = (): Sizes =>
  new Sizes({
    requestHeadersSize: Option.none(),
    requestBodySize: Option.none(),
    responseHeadersSize: Option.none(),
    responseBodySize: Option.none(),
    responseBodyEncodedSize: Option.none(),
    responseBodyDecodedSize: Option.none(),
    responseTransferSize: Option.none()
  })
const sum = (a: Option.Option<number>, b: Option.Option<number>) =>
  Option.isSome(a) && Option.isSome(b) ? count(a.value + b.value) : Option.none<number>()

interface Metrics {
  readonly requestHeaderBytesSent?: number | undefined
  readonly requestBodyBytesSent?: number | undefined
  readonly responseHeaderBytesReceived?: number | undefined
  readonly responseBodyBytesReceived?: number | undefined
  readonly responseBodyDecodedSize?: number | undefined
}
export const webkit = (native: Metrics | undefined): Sizes => {
  if (native === undefined) return empty()
  const headers = count(native.responseHeaderBytesReceived)
  const body = count(native.responseBodyBytesReceived)
  return new Sizes({
    ...empty(),
    requestHeadersSize: count(native.requestHeaderBytesSent),
    requestBodySize: count(native.requestBodyBytesSent),
    responseHeadersSize: headers,
    responseBodySize: body,
    responseBodyDecodedSize: count(native.responseBodyDecodedSize),
    responseTransferSize: sum(headers, body)
  })
}
interface Response {
  readonly protocol: string
  readonly status: number
  readonly fromCache: boolean
  readonly bytesReceived: number
  readonly headersSize: number | null
  readonly bodySize?: number | null | undefined
  readonly content?: { readonly size: number } | undefined
}
export const bidi = (native: Response, complete: boolean): Sizes => {
  if (native.fromCache || native.status === 304) return empty()
  const headers = count(native.headersSize)
  const total = complete ? count(native.bytesReceived) : Option.none<number>()
  // The pinned HTTP/1.1 probes establish matching total/header accounting. No other protocol is inferred.
  const body = native.protocol === "http/1.1" && Option.isSome(headers) && Option.isSome(total)
    ? count(total.value - headers.value) :
    Option.none<number>()
  return new Sizes({
    ...empty(),
    responseHeadersSize: headers,
    responseTransferSize: total,
    responseBodySize: body,
    responseBodyEncodedSize: complete ? count(native.bodySize) : Option.none()
    // Firefox reports content.size=0 even for nonempty bodies; it is deliberately never used.
  })
}
export const cdp = (total: number, decoded: number | undefined): Sizes =>
  new Sizes({
    ...empty(),
    responseTransferSize: count(total),
    responseBodyDecodedSize: count(decoded)
  })

/** At most 1000 active collectors per opted-in context; no request entries are retained. */
export interface Collector {
  readonly owner: string
  network: boolean
  decoded: number | undefined
}
export const keep = (store: Map<string, Collector>, hop: string, owner: string): void => {
  store.set(hop, { owner, network: false, decoded: 0 })
  if (store.size > 1000) store.delete(store.keys().next().value!)
}
