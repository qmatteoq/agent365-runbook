# Working on this repository

This repo is documentation. Almost every change is prose that someone will read while they follow along with a terminal open, so the writing matters as much as the accuracy.

## Always humanize generated prose

Any time you write or substantially rewrite Markdown here, run the `humanizer` skill over the result before you finish. Use it in embedded mode: run the draft, audit, and final pass internally, then produce only the final text. Do not paste the audit into the conversation.

This applies to runbooks, overviews, architecture pages, READMEs, PR descriptions, and commit messages. It does not apply to code, JSON, YAML, frontmatter, or link targets, which the skill leaves alone anyway.

The point is not to pass a detector. It is that these guides are written in a specific person's voice, and text that reads as machine generated breaks the illusion that a human is walking you through the steps.

## The voice
These are the rules to follow when writing documentation:

- First person plural. "We're going to", "let's get started", "we ended up with".
- Explain why before how. Frame the problem before showing the fix.
- Never assume infrastructure already exists. If a step needs a resource, show how to create it.
- Numbered portal steps with the UI labels in bold and the exact values to type.
- Prose after every code block explaining what it does and why it looks that way.
- Warnings as blockquotes, phrased as advice rather than as a label.
- Close with a "Wrapping up" section.
- Longer flowing sentences. Avoid terse fragments stacked for drama.

`01-scenarios/Web-App-Agent-User-OBO/3.Runbook.md` is the reference implementation. Match it when in doubt.

## No dashes in prose

Do not use em dashes (—) or en dashes (–) in prose. They are the most reliable tell that a machine wrote the text, and they are almost never the only punctuation that works. Reach for a comma first, then a period if the aside deserves its own sentence, a colon when what follows explains what came before, or parentheses for a genuine aside.

This overrides the `humanizer` skill's voice-calibration rule, which would otherwise preserve dashes because the existing docs are full of them. They are being removed, not matched.

Two things are left alone: hyphens in ordinary compounds (`sign-in`, `two-hop`, `on-behalf-of`) are not dashes, and anything inside a code block, a command, a URL, or a file path stays exactly as it is. Numeric ranges lose the dash too, so `60–90 min` becomes `60 to 90 min`.

## Accuracy
Check claims against the repo before writing them down. The starting points under `0.Resources/Starting-point/` and their READMEs are the authority for ports, configuration keys, and CLI flags. If an external source contradicts what is in the repo, say so rather than quietly picking one.
