# Structured Citations And Source Quality

Wikist keeps explanatory footnotes and verifiable sources separate. Footnotes remain suitable for remarks, translation notes, or proof details. Structured citations are reusable source records that travel with the Markdown article.

## Writing Workflow

1. Open an article editor and add a record in **References and source quality**.
2. Give it a stable citation key such as `hardy1908` or `atiyah-macdonald-1969`.
3. Enter authors, title, year, publication information, page range, and at least one verifier where available: DOI, arXiv, or a stable HTTPS URL.
4. Use the insert button beside the record, or write citation syntax directly in Markdown.

Citation syntax:

```markdown
The construction is standard [@hardy1908, p. 42].
Two complementary sources are useful [@atiyah-macdonald-1969; see @eisenbud1995, ch. 2].
This historical assertion still needs verification {{cite-needed|locate the original publication}}.
```

Wikist renders inline citations as numbered, clickable references. The reader sees a separate **References** section at the end of the article. Existing `[^footnote]` syntax is unchanged and remains a separate Notes section.

## Portable Storage

References are saved in Markdown front matter as a JSON array because this preserves structured fields without relying on the local SQLite database:

```yaml
references: [{"id":"hardy1908","type":"book","authors":["Hardy, G. H."],"title":"A Course of Pure Mathematics","publisher":"Cambridge University Press","year":"1908","pages":"42-44","doi":"10.1017/CBO9780511705876"}]
```

The article editor writes this field automatically. JSON page exports, Markdown exports, backups, restores, and Wikist imports preserve the same records.

## Record Fields

| Field | Purpose |
| :--- | :--- |
| `id` | Stable body citation key; lowercase letters, digits, `.`, `_`, `:`, and `-`. |
| `type` | `article`, `book`, `chapter`, `preprint`, `conference`, `thesis`, `web`, `dataset`, or `other`. |
| `authors` | Ordered author names. |
| `title` | Source title. |
| `containerTitle` | Journal, book, conference, archive, or site name. |
| `publisher` | Publisher or institution. |
| `year`, `volume`, `issue`, `pages` | Bibliographic location. |
| `doi`, `arxiv`, `url` | Resolver identifiers and stable links. |
| `accessed`, `language`, `note` | Web access date and verification context. |

The save API rejects malformed DOI, arXiv, URL, year, duplicate key, and oversized-record input. It does not make a network request during article save.

## Quality Signals

Each source is scored from fields that make a claim easier to verify: author, title, year, publication context, location, DOI/arXiv/URL, and relevant access notes. The article panel reports:

- number of records and inline citations;
- count of verifiable records;
- field completeness and aggregate quality score;
- unresolved `@key` references;
- explicit `{{cite-needed}}` markers.

The score is an editorial signal, not proof that a source is correct. Reviewers should still prefer original papers, standard monographs, authoritative surveys, official preprints, and primary archival material over search snippets or unsourced web pages.

## Review Queue

Senior editors and administrators can open **Admin -> Source review**. The queue supports pagination and search by article, author, title, DOI, or arXiv, with filters for:

- articles with no structured sources;
- articles with unresolved citation keys;
- articles that need field or claim-level source work;
- all articles for periodic audit.

## Import Behavior

Wikipedia import creates an attributed web reference for the imported page and inserts one matching inline citation. It does not claim that template-heavy MediaWiki references were perfectly converted; imported articles should be reviewed and upgraded to original mathematical sources where possible.
