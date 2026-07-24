# Wiki formatting & syntax guide

The wiki editor (`apps/web` → **Wiki**) is a **WYSIWYG** editor: you format text
with the toolbar and see the result as you type. Under the hood, pages are stored
as **Markdown**, so every toolbar action maps to a piece of Markdown you can also
type directly. This guide lists each option, the toolbar control, and the Markdown
it produces.

> The same reference is available in-app: open a page in **Edit** mode and click
> **Syntax** in the header.

---

## 1. How the editor works

- **Edit** tab — the rich toolbar editor. Type normally; use the toolbar (or type
  Markdown) to format.
- **Preview** tab — renders the page exactly as readers see it, including callout
  boxes and tables.
- **Save** — persists title + content over REST. The button reads *Saved* when
  there are no unsaved changes.
- Pages are stored as Markdown, so content round-trips cleanly and stays diff-able.

The toolbar, left to right:

```
[ Title ▾ ]  B  I  S  <>  |  • list   1. list   ☑ tasks   ❝ quote   </> code   |
🔗 link   ▦ table   — divider   ⓘ callout   |   📎 attach   😊 emoji
```

---

## 2. Text formatting

| Option        | Toolbar        | Markdown              |
| ------------- | -------------- | --------------------- |
| Bold          | **B**          | `**bold**`            |
| Italic        | *I*            | `*italic*`            |
| Strikethrough | ~~S~~          | `~~struck~~`          |
| Inline code   | `<>`           | `` `code` ``          |
| Link          | 🔗             | `[label](https://…)`  |

## 3. Titles (headings)

Use the **Title ▾** dropdown, or type the hashes.

| Option    | Markdown        |
| --------- | --------------- |
| Heading 1 | `# Heading 1`   |
| Heading 2 | `## Heading 2`  |
| Heading 3 | `### Heading 3` |
| Heading 4 | `#### Heading 4`|

## 4. Lists

| Option        | Toolbar | Markdown                       |
| ------------- | ------- | ------------------------------ |
| Bullet list   | •       | `- item`                       |
| Numbered list | 1.      | `1. item`                      |
| Task list     | ☑       | `- [ ] to do` / `- [x] done`   |

## 5. Blocks

### Quote

Toolbar **❝**:

```markdown
> Quoted text.
```

### Code block

Toolbar **</>** (code block, distinct from inline `<>`):

````markdown
```
function hello() {
  return "world"
}
```
````

### Divider

Toolbar **—** inserts a horizontal rule:

```markdown
---
```

### Table

Toolbar **▦** inserts a starter table. While the cursor is inside a table, a
contextual bar appears for adding/removing rows and columns and toggling the
header row.

```markdown
| Col A | Col B |
| ----- | ----- |
| a1    | b1    |
| a2    | b2    |
```

### Image / attachment

Toolbar **📎**, or drag-and-drop / paste a file into the editor. The file is
uploaded and the link is inserted automatically.

```markdown
![alt text](https://…)      <!-- image -->
[file name](https://…)       <!-- non-image attachment -->
```

## 6. Callout boxes (and “pin”)

Toolbar **ⓘ** opens the callout menu. Callouts are stored as GitHub-style
admonition blockquotes and rendered as colored boxes in Preview and on the public
Space. **Important** is the “pin” 📌 highlight for must-read notes.

| Callout            | Color  | Markdown                          |
| ------------------ | ------ | --------------------------------- |
| ℹ️ Note            | accent | `> [!NOTE] Useful context.`       |
| 💡 Tip             | green  | `> [!TIP] A helpful hint.`        |
| 📌 Important (pin) | accent | `> [!IMPORTANT] Must-read note.`  |
| ⚠️ Warning         | amber  | `> [!WARNING] Proceed with care.` |
| 🛑 Caution         | red    | `> [!CAUTION] Risky — read first.`|

Multi-line callouts continue with `>`:

```markdown
> [!IMPORTANT]
> This note spans multiple lines.
> Every line starts with `>`.
```

> [!NOTE]
> In the WYSIWYG editor a callout appears as a quote whose first line is the
> `[!TYPE]` marker. It renders as a full colored box in **Preview** and on the
> published page.

## 7. Mentions & emoji

- **@mention** — type `@` and pick a teammate from the popup.
- **Emoji** — the 😊 button opens an emoji picker; emoji are inserted as plain
  Unicode characters.

---

## Implementation notes

- Editor component: `packages/editor/src/RichTextEditor.tsx` (`toolbar="full"`
  enables code block / divider / callout). Shared with the issue comment composer,
  which uses the default `toolbar="compact"`.
- Callout rendering: `apps/web/src/lib/remark-callouts.ts` (remark plugin) +
  `.md-callout*` styles in `apps/web/src/styles/globals.css`. Applied by
  `MarkdownView` (`apps/web/src/components/feature/issue/markdown-view.tsx`).
- In-app guide: `apps/web/src/app/(app)/wiki/_components/syntax-help.tsx`.
