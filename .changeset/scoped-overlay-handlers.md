---
"@usestrider/browser": minor
---

Add scoped Page.addLocatorHandler for automatic overlay dismissal before actionability and waiting assertion checks, including retries. Handlers run serially on their page, inherit the triggering deadline, suppress recursive handling, and support times, noWaitAfter and idempotent early removal. Callback errors retain their original value in process through LocatorHandlerFailed or ExpectationFailed.handlerFailure.

Expect matcher and combinator error types now include Deadline.Timeout, preserving callback step timeouts with normal outer-operation attribution. Explicitly annotated expectation effects must add Deadline.Timeout to their error union, and exhaustive error handlers must handle Timeout and the new LocatorHandlerFailed locator reason. Ordinary unmet-condition expiry still fails with ExpectationFailed.
