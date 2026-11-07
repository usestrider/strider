/** Temporary redirect diagnostics; apply redirectCapture.patch to connect the hooks. */
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import type * as Adapter from "../../../src/internal/adapter.ts";
import type * as Transport from "../../../src/protocol/Transport.ts";
export declare const capture: (kind: string, value: unknown) => void;
export declare const wrap: (transport: Transport.Transport, sink: Adapter.Sink) => {
    transport: {
        send: (message: string) => Effect.Effect<void, Transport.TransportError, never>;
        messages: Stream.Stream<string, Transport.TransportError, never>;
        closed: Effect.Effect<Transport.ConnectionLost, never, never>;
    };
    sink: (fact: Adapter.Fact) => Effect.Effect<void, never, never>;
};
//# sourceMappingURL=redirectCapture.d.ts.map