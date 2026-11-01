/**
 * WebKitGTK's remote inspector socket without a browser: GVariant against the specification's examples
 * and the frames WebKitGTK 2.54.1's MiniBrowser sent and accepted, recorded in its first probe, and a connection to a
 * server that plays them.
 */
import * as NodeSocket from "@effect/platform-node/NodeSocket"
import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Stream from "effect/Stream"
import * as net from "node:net"
import * as GVariant from "../src/internal/gvariant.ts"
import * as InspectorSocket from "../src/internal/webkitInspectorSocket.ts"
import * as SocketConnector from "../src/protocol/SocketConnector.ts"

const hex = (text: string) => Uint8Array.from(text.match(/../g)!.map((byte) => parseInt(byte, 16)))
const toHex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")

// What the MiniBrowser accepted from us, and answered
const started =
  "000000400153746172744175746f6d6174696f6e53657373696f6e0065306236643062302d303030302d343030302d383030302d3030303030303030303030310000000025"
const didStart =
  "0000002e0144696453746172744175746f6d6174696f6e53657373696f6e004d696e6942726f7773657200322e35342e31000c"
const targetList =
  "00000081015365745461726765744c69737400010000000000000002000000000000004175746f6d6174696f6e0065306236643062302d303030302d343030302d383030302d303030303030303030303031006e756c6c00003d381300000000000000010000000000000057656250616765000061626f75743a626c616e6b00001d11104169"

describe("GVariant", () => {
  it("encodes and decodes the specification's examples", () => {
    // ('foo', -1) as (si): the string's end is the one framing offset
    assert.strictEqual(toHex(GVariant.encode("(si)", ["foo", -1])), "666f6f00ffffffff04")
    assert.deepStrictEqual(GVariant.decode("(si)", hex("666f6f00ffffffff04")), ["foo", -1])
    // An array of strings ends with each one's end
    const strings = ["i", "can", "has", "strings?"]
    assert.strictEqual(toHex(GVariant.encode("as", strings)), "690063616e0068617300737472696e67733f0002060a13")
    assert.deepStrictEqual(GVariant.decode("as", hex("690063616e0068617300737472696e67733f0002060a13")), strings)
  })

  it("round-trips what the socket's messages hold, and larger containers", () => {
    const cases: ReadonlyArray<readonly [string, GVariant.Value]> = [
      ["(tts)", [1n, 2n, "{\"id\":1}"]],
      ["(sa{sv})", ["session", [["acceptInsecureCerts", { type: "b", value: true }], ["n", { type: "u", value: 7 }]]]],
      ["(ta(tsssb))", [5n, [[7n, "Automation", "name", "", false], [9n, "WebPage", "t", "http://x/", true]]]],
      ["ai", [1, -2, 3]],
      ["aas", [["a"], [], ["b", "cd"]]],
      ["(ms)", ["present"]],
      ["(msi)", [null, 4]],
      ["(yb)", [255, true]],
      ["()", []],
      // Past 255 bytes, offsets take two
      ["as", Array.from({ length: 40 }, (_, index) => `string number ${index}`)]
    ]
    for (const [type, value] of cases) {
      assert.deepStrictEqual(GVariant.decode(type, GVariant.encode(type, value)), value, type)
    }
  })

  it("refuses malformed data and values", () => {
    assert.throws(() => GVariant.decode("s", hex("6869")), /nul/)
    assert.throws(() => GVariant.decode("ai", hex("010203")), /array of 4-byte/)
    assert.throws(() => GVariant.encode("(ss)", ["one"]), /tuple of 2/)
    assert.throws(() => GVariant.encode("t", 1), /bigint/)
    assert.throws(() => GVariant.encode("q(", 1), /ends early|more than one/)
  })
})

describe("The inspector socket's frames", () => {
  it("frames a message as the browser accepted it", () => {
    const framed = InspectorSocket.frame({
      _tag: "StartAutomationSession",
      sessionId: "e0b6d0b0-0000-4000-8000-000000000001",
      capabilities: []
    })
    assert.strictEqual(toHex(framed), started)
  })

  it("reads the browser's frames, however its bytes arrive", () => {
    const bytes = hex(didStart + targetList)
    const read = InspectorSocket.makeFrameReader()
    const messages = Array.from(bytes, (byte) => read(Uint8Array.of(byte))).flat()
    assert.deepStrictEqual(messages, [
      { _tag: "DidStartAutomationSession", browserName: "MiniBrowser", browserVersion: "2.54.1" },
      {
        _tag: "SetTargetList",
        connection: 1n,
        targets: [
          { id: 2n, type: "Automation", name: "e0b6d0b0-0000-4000-8000-000000000001", url: "null", paired: false },
          { id: 1n, type: "WebPage", name: "", url: "about:blank", paired: false }
        ]
      }
    ])
  })

  it("refuses a frame too small to have a name", () => {
    assert.throws(() => InspectorSocket.makeFrameReader()(hex("0000000101")), /frame of 1 bytes/)
  })

  it.live("connects, sends, and reads until the server goes", () =>
    Effect.gen(function*() {
      const received: Array<Uint8Array> = []
      const server = net.createServer((client) => {
        client.on("data", (data) => {
          received.push(new Uint8Array(data as Buffer))
          client.end(Buffer.from(hex(didStart + targetList)))
        })
      })
      const port = yield* Effect.callback<number>((resume) => {
        server.listen(0, "127.0.0.1", () => resume(Effect.succeed((server.address() as net.AddressInfo).port)))
      })
      yield* Effect.addFinalizer(() => Effect.sync(() => server.close()))
      const connection = yield* InspectorSocket.connect(
        yield* SocketConnector.fromSocket(yield* NodeSocket.makeNet({ host: "127.0.0.1", port }))
      )
      const collected: Array<InspectorSocket.Incoming> = []
      const drained = yield* connection.messages.pipe(
        Stream.runForEach((message) => Effect.sync(() => collected.push(message))),
        Effect.flip,
        Effect.forkScoped
      )
      yield* connection.send({
        _tag: "StartAutomationSession",
        sessionId: "e0b6d0b0-0000-4000-8000-000000000001",
        capabilities: []
      })
      // What the server sent before it closed, then why
      const failure = yield* Fiber.join(drained)
      assert.deepStrictEqual(collected.map((message) => message._tag), ["DidStartAutomationSession", "SetTargetList"])
      assert.strictEqual(toHex(received[0]!), started)
      const lost = yield* connection.closed
      assert.strictEqual(lost.initiator, "remote")
      assert.strictEqual(failure.reason, lost)
      const refused = yield* Effect.flip(connection.send({ _tag: "Setup", connection: 1n, target: 2n }))
      assert.strictEqual(refused.reason._tag, "ConnectionLost")
    }).pipe(Effect.scoped))
})
