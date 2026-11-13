/** Native request phase normalization. Called only by opted-in requests. */
import * as Option from "effect/Option"
import { Timing } from "../NetworkRequest.ts"

interface Native {
  readonly timestamp?: number | undefined
  readonly wallTime?: number | undefined
  readonly requestTime?: number | undefined
  readonly timeOrigin?: number | undefined
  readonly fetchStart?: number | undefined
  readonly startTime?: number | undefined
  readonly redirectStart?: number | undefined
  readonly dnsStart?: number | undefined
  readonly dnsEnd?: number | undefined
  readonly domainLookupStart?: number | undefined
  readonly domainLookupEnd?: number | undefined
  readonly connectStart?: number | undefined
  readonly connectEnd?: number | undefined
  readonly tlsStart?: number | undefined
  readonly sslStart?: number | undefined
  readonly secureConnectionStart?: number | undefined
  readonly sendStart?: number | undefined
  readonly requestStart?: number | undefined
  readonly receiveHeadersStart?: number | undefined
  readonly responseStart?: number | undefined
  readonly responseEnd?: number | undefined
}
export interface Origin {
  readonly timestamp: number
  readonly wallTime: number
}
const known = (n: number | undefined): n is number => n !== undefined && Number.isFinite(n)
const positive = (n: number | undefined): n is number => known(n) && n > 0
const phase = (n: number | undefined, zero: boolean) =>
  known(n) && (zero ? n >= 0 : n > 0) ? Option.some(n) : Option.none<number>()
export const empty = () =>
  new Timing({
    startTime: Option.none(),
    domainLookupStart: Option.none(),
    domainLookupEnd: Option.none(),
    connectStart: Option.none(),
    connectEnd: Option.none(),
    secureConnectionStart: Option.none(),
    requestStart: Option.none(),
    responseStart: Option.none(),
    responseEnd: Option.none()
  })
export const cdp = (origin: Origin, native: Native | undefined, end?: number): Timing => {
  if (native === undefined || !positive(native.requestTime) || !known(origin.timestamp) || !positive(origin.wallTime)) {
    return empty()
  }
  const base = native.requestTime
  return new Timing({
    startTime: Option.some((origin.wallTime + base - origin.timestamp) * 1000),
    domainLookupStart: phase(native.dnsStart, true),
    domainLookupEnd: phase(native.dnsEnd, true),
    connectStart: phase(native.connectStart, true),
    connectEnd: phase(native.connectEnd, true),
    secureConnectionStart: Option.none(),
    requestStart: phase(native.sendStart, true),
    responseStart: phase(native.receiveHeadersStart, true),
    responseEnd: phase(end === undefined ? undefined : (end - base) * 1000, true)
  })
}
export const bidi = (native: Native, complete: boolean): Timing => {
  if (!positive(native.requestTime) || !known(native.timeOrigin) || native.timeOrigin < 0) return empty()
  const base = native.requestTime
  const offset = (n: number | undefined) => positive(n) ? phase(n - base, true) : Option.none<number>()
  return new Timing({
    startTime: Option.some(native.timeOrigin + base),
    domainLookupStart: offset(native.dnsStart),
    domainLookupEnd: offset(native.dnsEnd),
    connectStart: offset(native.connectStart),
    connectEnd: offset(native.connectEnd),
    secureConnectionStart: Option.none(),
    requestStart: offset(native.requestStart),
    responseStart: offset(native.responseStart),
    responseEnd: complete ? offset(native.responseEnd) : Option.none()
  })
}
export const webkit = (origin: Origin, native: Native | undefined, end?: number): Timing => {
  if (native === undefined || !positive(native.fetchStart) || !known(origin.timestamp) || !positive(origin.wallTime)) {
    return empty()
  }
  const base = native.fetchStart
  return new Timing({
    startTime: Option.some((origin.wallTime + base - origin.timestamp) * 1000),
    domainLookupStart: phase(native.domainLookupStart, false),
    domainLookupEnd: phase(native.domainLookupEnd, false),
    connectStart: phase(native.connectStart, false),
    connectEnd: phase(native.connectEnd, false),
    secureConnectionStart: Option.none(),
    requestStart: phase(native.requestStart, false),
    responseStart: phase(native.responseStart, false),
    responseEnd: phase(end === undefined ? undefined : (end - base) * 1000, true)
  })
}

/** One native baseline in the opted-in context's bounded active-hop store. */
export interface Collector {
  readonly owner: string
  readonly response: (native: Native | undefined) => void
  readonly finish: (timestamp: number) => void
}
export const collector = (
  normalize: typeof cdp,
  origin: Origin,
  emit: (timing: Timing) => void,
  owner: string
): Collector => {
  let latest: Native | undefined
  return {
    owner,
    response: (native) => {
      latest = native
      emit(normalize(origin, native))
    },
    finish: (timestamp) => emit(normalize(origin, latest, timestamp))
  }
}

/** At most 1000 active native baselines per opted-in context, without retaining request entries. */
export const keep = (store: Map<string, Collector>, hop: string, value: Collector): void => {
  store.set(hop, value)
  if (store.size > 1000) store.delete(store.keys().next().value!)
}
