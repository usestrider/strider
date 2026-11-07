/** Temporary redirect diagnostics; apply redirectCapture.patch to connect the hooks. */
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as fs from "node:fs";
let sequence = 0;
let connection = 0;
export const capture = (kind, value) => {
    const directory = process.env["STRIDER_RECORD"];
    if (!directory)
        return;
    fs.mkdirSync(directory, { recursive: true });
    fs.appendFileSync(`${directory}/redirect-${process.pid}.ndjson`, JSON.stringify({
        sequence: ++sequence,
        at: Date.now(),
        kind,
        value
    }) + "\n");
};
export const wrap = (transport, sink) => {
    const id = ++connection;
    capture("connection", { id });
    return {
        transport: {
            send: (message) => Effect.andThen(Effect.sync(() => capture("send", { id, message: JSON.parse(message) })), transport.send(message)),
            messages: transport.messages.pipe(Stream.tap((message) => Effect.sync(() => capture("receive", { id, message: JSON.parse(message) })))),
            closed: transport.closed
        },
        sink: (fact) => Effect.andThen(Effect.sync(() => capture("fact", { id, fact })), sink(fact))
    };
};
//# sourceMappingURL=redirectCapture.js.map