# Error taxonomy (day 13)

Error analysis of 50 extraction traces, read by hand. This page is a template: the open codes, categories and priorities are written by the author, without AI, while reading the traces.

## Method

Error analysis in the style of Hamel Husain and Shreya Shankar: look at real traces before writing any new eval, and let the failure categories come from the data instead of guessing them.

1. **Open coding.** Read each trace (document, extraction, rule scores, repair) and write a short, concrete note of the first thing that went wrong, in your own words. One note per trace; no predefined labels. Stop at the first upstream error: later ones are usually its consequences.
2. **Axial coding.** Group the open codes into a small set of failure categories, merge near-duplicates, and count traces per category.
3. **Prioritize.** Rank categories by frequency and by how much each costs a user (a wrong total is worse than a missing customer name), then decide what changes next: a prompt change, a new rule, a code fix, or a targeted eval.

References:
- Hamel Husain, [Your AI Product Needs Evals](https://hamel.dev/blog/posts/evals/).
- Hamel Husain, [A Field Guide to Rapidly Improving AI Products](https://hamel.dev/blog/posts/field-guide/).
- Hamel Husain and Shreya Shankar, [LLM Evals: Everything You Need to Know (FAQ)](https://hamel.dev/blog/posts/evals-faq/).

## The 50 documents

| kind | source | documents | labeled |
|---|---|---:|---|
| real | declarando | 17 | no |
| real | quipu | 2 | no |
| real | iberdrola-example | 2 | no |
| synth | synth (degraded JPEG) | 29 | yes |
| **total** | | **50** | |

The real documents are every entry of `data/real/public/sources.jsonl` whose `use` is `eval`: public example invoices with no label, so only their rules are scored. The synthetic ones are the first 29 labels of `data/synth`, as degraded photos, scored field by field as well. Both runs used gpt-5-mini, `extract-document-v2` and `repair-v1`, and traced every document to the `eval` environment in Langfuse.

| run | command | started (UTC) |
|---|---|---|
| real | `pnpm eval:extract --sources data/real/public/sources.jsonl --use eval --limit 21 --repair` | 2026-10-02T06:11:30Z |
| synth | `pnpm eval:extract --dataset data/synth --format jpg --limit 29 --repair` | 2026-10-02T06:19:02Z |

The worksheet is `data/evals/error-analysis-2026-10-02.csv` (Excel, `;`, UTF-8) and the same rows as a table in `data/evals/error-analysis-2026-10-02.md`; both are git-ignored like the rest of `data/`. Failures come first: rules invalid, an extraction error, or a synthetic document that is not an exact match. Each row links to its trace in the local Langfuse.

## Open codes

One row per trace, filled while reading.

| n | trace | open code |
|---|---|---|
| | | |

## Categories

| category | definition | traces | count |
|---|---|---|---:|
| | | | |

## Top 3, prioritized

1.
2.
3.

## What changes next

-
