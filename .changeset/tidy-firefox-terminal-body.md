---
"@usestrider/browser": patch
---

Correct Firefox completion tracking for terminal 3xx responses, retire completed requests within the retention bound, and prevent a pending response body read from returning a later redirect hop's bytes. Firefox can still leave native body retrieval pending for a terminal 302 without a Location header; collection reports BodyUnavailable with why: "streaming" at its deadline.
