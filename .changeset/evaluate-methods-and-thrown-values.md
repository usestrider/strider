---
"@usestrider/browser": patch
---

Evaluate a method, such as `sum(a, b) { … }`, an async method, a generator, a getter, or a setter, in every call that runs a function in the page, where its source used to fail with `SyntaxError`. A thrown value that isn't an object, such as `throw "qwerty"`, `throw null`, or `Promise.reject(7)`, now gives `EvaluationThrown` an `Error` whose message is the value: on Chromium the message was `Uncaught`, and a thrown string such as `"Foo: bar"` was read as an error named `Foo`.
