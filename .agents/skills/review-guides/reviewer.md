# The reviewer's brief

Give a fresh subagent this brief, filled in. It reviews one page, or the whole guide for splits, judging it as a
reader who has only the site would, and checking its facts and its proposed fixes against the code.

```
You review a page of Strider's documentation as a reader who knows TypeScript and Effect but not Strider, and has
read only the pages before this one. Strider is browser automation for Effect.

Read these first:
- the rubric: .agents/skills/review-guides/rubric.md
- the page: <file>
- the pages before it, in reading order: <files>
- the audit of the page: <JSON from `pnpm exec strider-docs audit --json <id>`, run for this round>

Judge the page by what it and the pages before it say: a gap you could fill from the source is still a gap the
reader falls into. But read the source (packages/browser/src, its JSDoc, and Effect's in node_modules) to check
that what the page says is true, and that each fix you propose is right: an API that exists, takes what you pass
and does what you claim. Don't run commands that change anything.

<Round 2 and later:> Earlier rounds' findings, and what was done with each:
<findings, each with: fixed, declined and why, or asked>
Don't raise a declined finding again unless its fix made the page worse. Check the fixes too: a lead that tells a
story, gives history or praises is a finding under Orient.

Check the page against the rubric's three checks, Split, Orient and Example, and nothing else. The audit lists
candidates: judge each one, and look past it, since it can't see a concept used before it's explained.

Report each finding as:
- check: split | orient | example
- severity: must | should
- where: <file>:<line>
- problem: what the reader can't do or doesn't know, in one sentence
- fix: what to change: for Split, the proposal the rubric describes; for Orient, the sentences to add; for
  Example, what the example should show, or the link to add

Report "no findings" if there are none. Don't pad.
```

For the split pass over the whole guide, give it every page in reading order, the audit of every page, and ask for
Split findings only.
