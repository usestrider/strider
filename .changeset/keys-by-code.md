---
"@usestrider/browser": patch
---

Press keys by their physical code. `keyboard.press`, `keyboard.hold`, and `locator.press` take a key's UI Events `code` beside key values and characters: the right-hand modifiers (`ShiftRight`, `ControlRight`, `AltRight`, `MetaRight`), the numeric keypad (`Numpad0`–`Numpad9`, `NumpadAdd`, `NumpadSubtract`, `NumpadMultiply`, `NumpadDivide`, `NumpadDecimal`, `NumpadEnter`), typed with Num Lock on, every code a keyboard layout types on (`KeyW` types what the context's layout puts there, `z` on `fr`), and the audio and media keys. Bare `Shift`, `Control`, `Alt`, and `Meta` stay the left-hand keys, and each key event reports its `location` on every backend. The media keys are sent on Chromium only, and refused elsewhere as `Unsupported` (`input.mediaKeys`, a new capability); on Firefox and WebKit, a code whose layout's character a US keyboard has elsewhere, and `NumpadEnter` on WebKit, are refused as `Unsupported` (`input.keyboardLayout`).
