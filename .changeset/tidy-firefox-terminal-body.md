---
"@usestrider/browser": patch
---

Correct Firefox completion tracking for terminal 3xx responses, retire completed requests within the retention bound, and prevent pending response body reads from returning a later redirect hop's bytes. Firefox terminal 3xx responses without a Location header now fail body collection immediately with ResponseError reason Unsupported, capability network.responseBody.terminalRedirect, because Firefox does not answer network.getData for them. Chromium and WebKit continue returning these bodies; followed redirect hops remain unavailable and final-response bodies remain readable.
