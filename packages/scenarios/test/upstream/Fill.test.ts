// Modified port of microsoft/playwright tests/page/page-fill.spec.ts.
// Copyright 2017 Google Inc. Modifications copyright Microsoft Corporation.
// Apache-2.0; original source, license and NOTICE: ../../upstream/playwright/.
// Diagnostic differences: normalization, validation and editable descendants.
import { Deadline, Expect, PageNavigation } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import { afterAll, beforeAll, describe, expect } from "vitest"
import { inputCase, type InputSite } from "./inputCase.ts"
import { frames, inputSite } from "./inputSite.ts"
import { runs } from "./timing.ts"

let site: InputSite
beforeAll(async () => {
  site = await inputSite()
})
afterAll(async () => {
  await site?.close()
})
const result = () => (window as unknown as Window & { result: string }).result

for (const { library, sample } of runs) {
  describe(`Playwright fill / ${library} / sample ${sample}`, () => {
    const scenario = inputCase(library, () => site)

    for (const [id, selector] of [["FI-001", "textarea"], ["FI-002", "input"]] as const) {
      scenario(
        `${id} should fill ${selector}`,
        "@textarea",
        Effect.fn(id)(function*(page) {
          yield* page.locator(selector).fill("some value")
          expect(yield* page.evaluateInMainWorld(result)).toBe("some value")
        }),
        async (page) => {
          await page.fill(selector, "some value")
          expect(await page.evaluate(result)).toBe("some value")
        }
      )
    }

    for (const type of ["button", "checkbox", "file", "image", "radio", "reset", "submit"]) {
      scenario(
        `FI-003 should throw on unsupported inputs: ${type}`,
        "@textarea",
        Effect.fn("FI-003")(function*(page) {
          const input = page.locator("input")
          yield* input.evaluate((el, type) => el.setAttribute("type", type), type)
          expect(yield* Effect.flip(input.fill("")))
            .toMatchObject({ _tag: "LocatorError", reason: { _tag: "NotEditable" } })
        }),
        async (page) => {
          await page.locator("input").evaluate((el, type) => el.setAttribute("type", type), type)
          await expect(page.fill("input", "")).rejects.toThrow(`Input of type "${type}" cannot be filled`)
        }
      )
    }

    for (const type of ["password", "search", "tel", "text", "url", "invalid-type"]) {
      scenario(
        `FI-004 should fill different input types: ${type}`,
        "@textarea",
        Effect.fn("FI-004")(function*(page) {
          yield* page.locator("input").evaluate((el, type) => el.setAttribute("type", type), type)
          yield* page.locator("input").fill("text " + type)
          expect(yield* page.evaluateInMainWorld(result)).toBe("text " + type)
        }),
        async (page) => {
          await page.locator("input").evaluate((el, type) => el.setAttribute("type", type), type)
          await page.fill("input", "text " + type)
          expect(await page.evaluate(result)).toBe("text " + type)
        }
      )
    }

    scenario(
      "FI-005 should fill range input",
      "<input type=range min=0 max=100 value=50>",
      Effect.fn("FI-005")(function*(page) {
        const input = page.locator("input")
        yield* input.fill("42")
        expect(yield* input.readValue).toBe("42")
        for (const [value, expected] of [["42.0", 42], ["1e1", 10]] as const) {
          yield* input.fill(value)
          expect(yield* input.evaluate((el) => (el as HTMLInputElement).valueAsNumber)).toBe(expected)
        }
      }),
      async (page) => {
        await page.fill("input", "42")
        expect(await page.inputValue("input")).toBe("42")
        for (const [value, expected] of [["42.0", 42], ["1e1", 10]] as const) {
          await page.fill("input", value)
          expect(await page.locator("input").evaluate((el) => (el as HTMLInputElement).valueAsNumber)).toBe(expected)
        }
      }
    )

    for (
      const [id, name, type, value, expected] of [
        ["FI-006", "color input", "color", "#aaaaaa", "#aaaaaa"],
        ["FI-007", "color input case insensitive", "color", "#AbCd00", "#abcd00"],
        ["FI-008", "date input after clicking", "date", "2020-03-02", "2020-03-02"],
        ["FI-010", "time input", "time", "13:15", "13:15"],
        ["FI-011", "month input", "month", "2020-07", "2020-07"],
        ["FI-012", "week input", "week", "2020-W50", "2020-W50"]
      ] as const
    ) {
      scenario(
        `${id} should fill ${name}`,
        `<input type=${type}${type === "color" ? " value=\"#e66465\"" : ""}>`,
        Effect.fn(id)(function*(page) {
          const input = page.locator("input")
          if (id === "FI-008") yield* input.click()
          yield* input.fill(value)
          expect(yield* input.readValue).toBe(expected)
        }),
        async (page) => {
          if (id === "FI-008") await page.click("input")
          await page.fill("input", value)
          expect(await page.inputValue("input")).toBe(expected)
        }
      )
    }

    for (
      const [type, value] of Object.entries({
        color: "#aaaaaa",
        date: "2020-03-02",
        time: "13:15",
        "datetime-local": "2020-03-02T13:15:30",
        month: "2020-03",
        range: "42",
        week: "2020-W50"
      })
    ) {
      const html = `<body><script>
        const div = document.createElement('div');
        const shadowRoot = div.attachShadow({mode: 'open'});
        shadowRoot.innerHTML = '<input type=${type}></input>';
        document.body.appendChild(div);
        window.firedEvents = []; window.firedBodyEvents = [];
        for (const type of ['input', 'change']) {
          document.body.addEventListener(type, e => firedBodyEvents.push(e.type + ':' + e.composed));
          shadowRoot.querySelector('input').addEventListener(type, e => firedEvents.push(e.type + ':' + e.composed));
        }
      </script></body>`
      const events = () => {
        const state = window as unknown as Window & { firedEvents: Array<string>; firedBodyEvents: Array<string> }
        return { input: state.firedEvents, body: state.firedBodyEvents }
      }
      scenario(
        `FI-009 input event.composed should cross shadow dom boundary: ${type}`,
        html,
        Effect.fn("FI-009")(function*(page) {
          yield* page.locator("input").fill(value)
          expect(yield* page.evaluateInMainWorld(events))
            .toEqual({ input: ["input:true", "change:false"], body: ["input:true"] })
        }),
        async (page) => {
          await page.locator("input").fill(value)
          expect(await page.evaluate(events)).toEqual({ input: ["input:true", "change:false"], body: ["input:true"] })
        }
      )
    }

    scenario(
      "FI-013 should fill datetime-local input",
      "<input type=datetime-local>",
      Effect.fn("FI-013")(function*(page) {
        const input = page.locator("input")
        yield* input.fill("2020-03-02T05:15")
        expect(yield* input.readValue).toBe("2020-03-02T05:15")
        yield* input.fill("2020-03-02T06:20:00")
        expect(yield* input.readValue).toBe("2020-03-02T06:20")
      }),
      async (page) => {
        await page.fill("input", "2020-03-02T05:15")
        expect(await page.inputValue("input")).toBe("2020-03-02T05:15")
        await page.fill("input", "2020-03-02T06:20:00")
        expect(await page.inputValue("input")).toBe("2020-03-02T06:20")
      }
    )

    scenario(
      "FI-014 should fill contenteditable",
      "@textarea",
      Effect.fn("FI-014")(function*(page) {
        yield* page.locator("div[contenteditable]").fill("some value")
        expect(yield* page.locator("div[contenteditable]").evaluate((el) => el.textContent)).toBe("some value")
      }),
      async (page) => {
        await page.fill("div[contenteditable]", "some value")
        expect(await page.locator("div[contenteditable]").textContent()).toBe("some value")
      }
    )

    scenario(
      "FI-015 should fill contenteditable with new lines",
      "<div contenteditable=\"true\"></div>",
      Effect.fn("FI-015")(function*(page) {
        yield* page.locator("div[contenteditable]").fill("John\nDoe")
        expect(yield* page.locator("div[contenteditable]").evaluate((el) => (el as HTMLElement).innerText)).toBe(
          "John\nDoe"
        )
      }),
      async (page) => {
        await page.locator("div[contenteditable]").fill("John\nDoe")
        expect(await page.locator("div[contenteditable]").innerText()).toBe("John\nDoe")
      }
    )

    scenario(
      "FI-016 should not double-fill with beforeinput handler",
      `
      <div id="editor" contenteditable="true"></div>
      <script>const editor = document.getElementById('editor');
      editor.addEventListener('beforeinput', event => { event.preventDefault(); editor.textContent = event.data; });</script>`,
      Effect.fn("FI-016")(function*(page) {
        yield* page.locator("#editor").fill("Playwright")
        yield* page.locator("#editor").pipe(Expect.toHaveText("Playwright"))
      }),
      async (page) => {
        await page.locator("#editor").fill("Playwright")
        await expect.poll(() => page.locator("#editor").textContent()).toBe("Playwright")
      }
    )

    scenario(
      "FI-017 should fill elements with existing value and selection",
      "@textarea",
      Effect.fn("FI-017")(function*(page) {
        const input = page.locator("input")
        yield* input.evaluate((el) => {
          ;(el as HTMLInputElement).value = "value one"
        })
        yield* input.fill("another value")
        expect(yield* page.evaluateInMainWorld(result)).toBe("another value")
        yield* input.evaluate((el) => {
          ;(el as HTMLInputElement).selectionStart = 1
          ;(el as HTMLInputElement).selectionEnd = 2
        })
        yield* input.fill("maybe this one")
        expect(yield* page.evaluateInMainWorld(result)).toBe("maybe this one")
        const editor = page.locator("div[contenteditable]")
        yield* editor.evaluate(selectExisting)
        yield* editor.fill("replace with this")
        expect(yield* editor.evaluate((el) => el.textContent)).toBe("replace with this")
      }),
      async (page) => {
        const input = page.locator("input")
        await input.evaluate((el) => {
          ;(el as HTMLInputElement).value = "value one"
        })
        await page.fill("input", "another value")
        expect(await page.evaluate(result)).toBe("another value")
        await input.evaluate((el) => {
          ;(el as HTMLInputElement).selectionStart = 1
          ;(el as HTMLInputElement).selectionEnd = 2
        })
        await page.fill("input", "maybe this one")
        expect(await page.evaluate(result)).toBe("maybe this one")
        await page.locator("div[contenteditable]").evaluate(selectExisting)
        await page.fill("div[contenteditable]", "replace with this")
        expect(await page.locator("div[contenteditable]").textContent()).toBe("replace with this")
      }
    )

    scenario(
      "FI-018 should reject an element that is not editable",
      "<select><option>value1</option></select>",
      Effect.fn("FI-018")(function*(page) {
        expect(yield* Effect.flip(page.locator("select").fill("")))
          .toMatchObject({ _tag: "LocatorError", reason: { _tag: "NotEditable" } })
      }),
      async (page) => {
        await expect(page.fill("select", "")).rejects.toThrow(
          "Element is not an <input>, <textarea> or [contenteditable] element"
        )
      }
    )

    scenario(
      "FI-019 should throw if passed a non-string value",
      "@textarea",
      Effect.fn("FI-019")(function*(page) {
        // @ts-expect-error Deliberate upstream JavaScript caller validation case.
        expect(yield* Effect.flip(page.locator("textarea").fill(123)))
          .toMatchObject({ _tag: "LocatorError", reason: { _tag: "InvalidInput" } })
      }),
      async (page) => {
        // @ts-expect-error Deliberate upstream JavaScript caller validation case.
        await expect(page.fill("textarea", 123)).rejects.toThrow("value: expected string, got number")
      }
    )

    for (
      const [id, name, selector, attribute] of [
        ["FI-020", "disabled", "input", "disabled"],
        ["FI-021", "readonly", "textarea", "readonly"],
        ["FI-022", "invisible", "input", "hidden"]
      ] as const
    ) {
      scenario(
        `${id} should retry on ${name} element`,
        "@textarea",
        Effect.fn(id)(function*(page) {
          const input = page.locator(selector)
          yield* input.evaluate((el, attribute) => el.setAttribute(attribute, ""), attribute)
          const pending = yield* input.fill("some value").pipe(Effect.forkScoped)
          yield* page.evaluate(frames)
          expect(pending.pollUnsafe()).toBeUndefined()
          expect(yield* page.evaluateInMainWorld(result)).toBe("")
          yield* input.evaluate((el, attribute) => el.removeAttribute(attribute), attribute)
          yield* Fiber.join(pending)
          expect(yield* page.evaluateInMainWorld(result)).toBe("some value")
        }),
        async (page) => {
          const input = page.locator(selector)
          await input.evaluate((el, attribute) => el.setAttribute(attribute, ""), attribute)
          let done = false
          const pending = page.fill(selector, "some value").then(() => {
            done = true
          })
          await page.evaluate(frames)
          expect(done).toBe(false)
          expect(await page.evaluate(result)).toBe("")
          await input.evaluate((el, attribute) => el.removeAttribute(attribute), attribute)
          await pending
          expect(await page.evaluate(result)).toBe("some value")
        }
      )
    }

    scenario(
      "FI-023 should be able to fill the body",
      "<body contentEditable=\"true\"></body>",
      Effect.fn("FI-023")(function*(page) {
        yield* page.locator("body").fill("some value")
        expect(yield* page.evaluate(() => document.body.textContent)).toBe("some value")
      }),
      async (page) => {
        await page.fill("body", "some value")
        expect(await page.evaluate(() => document.body.textContent)).toBe("some value")
      }
    )

    scenario(
      "FI-024 should fill fixed position input",
      "<input style='position: fixed;' />",
      Effect.fn("FI-024")(function*(page) {
        yield* page.locator("input").fill("some value")
        expect(yield* page.locator("input").readValue).toBe("some value")
      }),
      async (page) => {
        await page.fill("input", "some value")
        expect(await page.inputValue("input")).toBe("some value")
      }
    )

    scenario(
      "FI-025 should fill when focus is in the wrong frame",
      `<div contentEditable="true"></div><iframe srcdoc="<body contenteditable><p>old</p></body>"></iframe>`,
      Effect.fn("FI-025")(function*(page) {
        yield* page.locator("iframe").focus()
        yield* page.locator("div").fill("some value")
        expect(yield* page.locator("div").evaluate((el) => el.textContent)).toBe("some value")
        const paragraph = page.frame(page.locator("iframe")).locator("p")
        yield* paragraph.fill("new")
        yield* paragraph.pipe(Expect.toHaveText("new"), Deadline.within("5 seconds"))
      }),
      async (page) => {
        await page.focus("iframe")
        await page.fill("div", "some value")
        expect(await page.locator("div").textContent()).toBe("some value")
        const paragraph = page.frameLocator("iframe").locator("p")
        await paragraph.fill("new")
        await expect.poll(() => paragraph.textContent(), { timeout: 5000 }).toBe("new")
      }
    )

    scenario(
      "filling an inherited editable descendant focuses its frame",
      `<div contenteditable></div><iframe srcdoc="<body contenteditable><p>old</p></body>"></iframe>`,
      Effect.fn("FI-inherited-editable")(function*(page) {
        yield* page.locator("div").fill("parent")
        const paragraph = page.frame(page.locator("iframe")).locator("p")
        yield* paragraph.fill("new")
        expect(yield* paragraph.evaluate((el) => el.textContent)).toBe("new")
        expect(yield* page.locator("div").evaluate((el) => el.textContent)).toBe("parent")
      }),
      async (page) => {
        await page.fill("div", "parent")
        const paragraph = page.frameLocator("iframe").locator("p")
        await paragraph.fill("new")
        expect(await paragraph.textContent()).toBe("new")
        expect(await page.locator("div").textContent()).toBe("parent")
      }
    )

    for (
      const [id, name, value] of [["FI-026", "number", "42"], ["FI-027", "exponent", "-10e5"], [
        "FI-028",
        "empty string",
        ""
      ]]
    ) {
      scenario(
        `${id} should fill input[type=number] with ${name}`,
        `<input id="input" type="number" ${value === "" ? "value=\"123\"" : ""}></input>`,
        Effect.fn(id!)(function*(page) {
          yield* page.locator("input").fill(value!)
          expect(yield* page.locator("input").readValue).toBe(value)
        }),
        async (page) => {
          await page.fill("input", value!)
          expect(await page.inputValue("input")).toBe(value)
        }
      )
    }

    scenario(
      "FI-029 should reject text in input[type=number]",
      "<input id=\"input\" type=\"number\"></input>",
      Effect.fn("FI-029")(function*(page) {
        expect(yield* Effect.flip(page.locator("input").fill("abc")))
          .toMatchObject({ _tag: "LocatorError" })
      }),
      async (page) => {
        await expect(page.fill("input", "abc")).rejects.toThrow("Cannot type text into input[type=number]")
      }
    )

    scenario(
      "FI-030 should clear using fill",
      "@textarea",
      Effect.fn("FI-030")(function*(page) {
        yield* page.locator("input").fill("some value")
        expect(yield* page.evaluateInMainWorld(result)).toBe("some value")
        yield* page.locator("input").fill("")
        expect(yield* page.evaluateInMainWorld(result)).toBe("")
      }),
      async (page) => {
        await page.fill("input", "some value")
        expect(await page.evaluate(result)).toBe("some value")
        await page.fill("input", "")
        expect(await page.evaluate(result)).toBe("")
      }
    )

    scenario(
      "FI-031 should not throw when fill causes navigation",
      "<input type=date>",
      Effect.fn("FI-031")(function*(page) {
        yield* page.evaluateInMainWorld(() =>
          document.querySelector("input")!.addEventListener("input", () => {
            window.location.href = "/empty.html"
          })
        )
        const navigation = yield* PageNavigation.next(page)
        yield* page.locator("input").fill("2020-03-02")
        yield* navigation
        expect(yield* page.url).toContain("empty.html")
      }),
      async (page) => {
        await page.locator("input").evaluate((el) =>
          el.addEventListener("input", () => {
            window.location.href = "/empty.html"
          })
        )
        await Promise.all([page.waitForURL("**/empty.html"), page.fill("input", "2020-03-02")])
        expect(page.url()).toContain("empty.html")
      }
    )

    scenario(
      "FI-032 fill back to back",
      "<input id=\"one\"></input><input id=\"two\"></input>",
      Effect.fn("FI-032")(function*(page) {
        yield* page.locator("#one").fill("first value")
        yield* page.locator("#two").fill("second value")
        yield* page.locator("#one").pipe(Expect.toHaveValue("first value"))
        yield* page.locator("#two").pipe(Expect.toHaveValue("second value"))
      }),
      async (page) => {
        await page.fill("#one", "first value")
        await page.fill("#two", "second value")
        await expect.poll(() => page.inputValue("#one")).toBe("first value")
        await expect.poll(() => page.inputValue("#two")).toBe("second value")
      }
    )

    scenario(
      "FI-033 should fill contenteditable with focus handler collapsing selection",
      `
      <div contenteditable="true">initial text</div>
      <script>const editor = document.querySelector('[contenteditable]');
      editor.addEventListener('focus', () => { const selection = window.getSelection(); if (selection.rangeCount > 0) selection.collapseToEnd(); });</script>`,
      Effect.fn("FI-033")(function*(page) {
        yield* page.locator("div[contenteditable]").fill("some value")
        expect(yield* page.locator("div[contenteditable]").evaluate((el) => el.textContent)).toBe("some value")
      }),
      async (page) => {
        await page.fill("div[contenteditable]", "some value")
        expect(await page.locator("div[contenteditable]").textContent()).toBe("some value")
      }
    )

    scenario(
      "FI-034 should retry on inert element",
      "<div inert id=container><input id=target></div><input id=outside>",
      Effect.fn("FI-034")(function*(page) {
        yield* page.locator("#outside").focus()
        const pending = yield* page.locator("#target").fill("some value").pipe(Effect.forkScoped)
        yield* page.evaluate(frames)
        expect(pending.pollUnsafe()).toBeUndefined()
        expect(yield* page.locator("#target").readValue).toBe("")
        expect(yield* page.locator("#outside").readValue).toBe("")
        yield* page.locator("#container").evaluate((el) => el.removeAttribute("inert"))
        yield* Fiber.join(pending)
        expect(yield* page.locator("#target").readValue).toBe("some value")
        expect(yield* page.locator("#outside").readValue).toBe("")
      }),
      async (page) => {
        await page.focus("#outside")
        let done = false
        const pending = page.fill("#target", "some value").then(() => {
          done = true
        })
        await page.evaluate(frames)
        expect(done).toBe(false)
        expect(await page.inputValue("#target")).toBe("")
        expect(await page.inputValue("#outside")).toBe("")
        await page.locator("#container").evaluate((el) => el.removeAttribute("inert"))
        await pending
        expect(await page.inputValue("#target")).toBe("some value")
        expect(await page.inputValue("#outside")).toBe("")
      }
    )

    scenario(
      "FI-035 should retry outside of a modal dialog",
      `<input id=target><dialog id=dialog><input id=inside></dialog><script>document.getElementById('dialog').showModal();</script>`,
      Effect.fn("FI-035")(function*(page) {
        yield* page.locator("#inside").fill("inside value")
        expect(yield* page.locator("#inside").readValue).toBe("inside value")
        const pending = yield* page.locator("#target").fill("some value").pipe(Effect.forkScoped)
        yield* page.evaluate(frames)
        expect(pending.pollUnsafe()).toBeUndefined()
        expect(yield* page.locator("#target").readValue).toBe("")
        yield* page.locator("#dialog").evaluate((el) => (el as HTMLDialogElement).close())
        yield* Fiber.join(pending)
        expect(yield* page.locator("#target").readValue).toBe("some value")
      }),
      async (page) => {
        await page.fill("#inside", "inside value")
        expect(await page.inputValue("#inside")).toBe("inside value")
        let done = false
        const pending = page.fill("#target", "some value").then(() => {
          done = true
        })
        await page.evaluate(frames)
        expect(done).toBe(false)
        expect(await page.inputValue("#target")).toBe("")
        await page.locator("#dialog").evaluate((el) => (el as HTMLDialogElement).close())
        await pending
        expect(await page.inputValue("#target")).toBe("some value")
      }
    )

    scenario(
      "FI-036 should fail with a useful error on inert element",
      "<div inert><input></div>",
      Effect.fn("FI-036")(function*(page) {
        const error = yield* Effect.flip(page.locator("input").fill("some value").pipe(Deadline.within("1 second")))
        expect(error).toMatchObject({ _tag: "Timeout" })
        expect(JSON.stringify(error)).toMatch(/inert/i)
      }),
      async (page) => {
        const error = await page.fill("input", "some value", { timeout: 1000 }).catch((error: Error) => error)
        expect(error).toBeInstanceOf(Error)
        expect((error as Error).message).toContain("Timeout 1000ms exceeded")
        expect((error as Error).message).toContain("element is inert")
      }
    )
  })
}

function selectExisting(div: Element) {
  div.innerHTML = "some text <span>some more text<span> and even more text"
  const range = document.createRange()
  range.selectNodeContents(div.querySelector("span")!)
  const selection = window.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
}
