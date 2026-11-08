---
"@usestrider/browser": minor
---

Align snapshot pressed, expanded and selected markers with role filters. Keywords are ASCII case-insensitive without trimming, and markers appear only for true on supported roles. Native option selection and details open state take precedence over ARIA.

Update stored snapshot expectations: uppercase true now adds markers; unsupported-role attributes and aria-selected=true on native-unselected options no longer add them. Open details now has expanded, including ordinary group details; closed details loses any ARIA-only expanded marker. The snapshot shape and filter defaults are unchanged, and group expanded filters remain invalid. These states follow Strider query policy, which can differ from browser accessibility trees.
