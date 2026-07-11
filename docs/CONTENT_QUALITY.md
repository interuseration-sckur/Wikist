# Content Quality Standard

Wikist content should be written for readers who care about precision. It should not imitate a social feed, a short answer site, or a loose note collection.

## Article Checklist

- The opening paragraph states the object and why it matters.
- Every major term is defined before it is used heavily.
- The formal definition and the intuitive explanation are separated.
- At least one nontrivial example is included.
- Important theorems include conditions, conclusion, and proof or proof sketch.
- Notation is consistent throughout the page.
- Related pages are linked with `[[slug|label]]`.
- Claims that are historical, uncommon, or advanced should cite sources.

## Structured Citations

Use a structured source record instead of placing bibliographic prose only in a footnote. Add the record in the article editor, then cite it in the body:

```markdown
The theorem is stated in a standard form [@atiyah-macdonald-1969, ch. 1].

{{cite-needed|find a primary source for this historical statement}}
```

Prefer original papers, recognized monographs, official preprints, and institutional sources. DOI, arXiv, publication name, year, and the exact page or theorem location make mathematical claims substantially easier to audit. See [Structured citations](CITATIONS.md) for record fields and review rules.

## Stable Review

`status: stable` is an editorial label, while a **reviewed stable version** is an immutable snapshot approved by a senior editor or administrator. Before approval, compare the current Markdown with the last stable snapshot, check source-quality signals, and leave a concise review note describing the decision. A request for changes should identify the missing claim support, definition, condition, or proof gap. See [Lightweight stable revision review](REVISION_REVIEW.md) for the storage and permission model.

## Math Article Template

```markdown
# Term

Short description.

## Definition

::: definition Term
Formal definition.
:::

## Examples

- Example.

## Main Properties

::: theorem Theorem
Statement.
:::

::: proof Proof
Proof.
:::

## Related Pages

- [[group|群]]
```

## Review Labels

- `stable`: ready for normal readers.
- `review`: useful but still needs expert review.
- `draft`: incomplete or provisional.

## Quality Labels

- `A`: comprehensive and proof-aware.
- `B`: reliable main body, missing some detail.
- `C`: usable but thin.
- `Draft`: placeholder or early version.
