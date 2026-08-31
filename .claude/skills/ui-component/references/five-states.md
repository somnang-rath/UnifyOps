# The five states

**Every view specifies all five.** Not a checklist to complete later — a view with only the success state is
half-built, and the missing four are the ones users hit on their worst day.

| State | Requirement |
| --- | --- |
| **Loading** | Skeletons matching the final layout. Never a full-page spinner, never layout shift on arrival |
| **Empty** | Says what this is and offers the primary action. A live input, not a shrug. Where empty is *good news* (My Work), say so |
| **Success** | Optimistic. A toast only when the result isn't visible on screen |
| **Error** | Plain language, says what to do next, **retains user input**. Never a raw error code |
| **Edge** | Long titles · 50 assignees · 200 columns · deleted-while-viewing · permission-lost-while-viewing · offline · Khmer text with no spaces |

## Loading

The skeleton is the final layout with the text replaced, so nothing moves when data lands. If the skeleton
and the real thing have different heights, you have built a layout shift, not a loading state. Board columns
keep their widths; table rows keep their 36px height; the sidebar keeps its slots.

## Empty

Three empties, and they are not the same component:

- **Nothing exists yet** — explain what this view is for and put the primary action *in* the empty state as a
  live control. "No items yet" with no way to create one is a dead end.
- **Nothing matches the filter** — say which filter is responsible and offer to clear it. Never offer "create"
  here; the user is looking, not authoring.
- **Empty is good news** — My Work with nothing overdue, a cycle with nothing blocked. Say so plainly. A
  neutral "no results" reads as a failure when the user has actually just finished everything.

## Error

Retaining user input is the part that gets dropped. A failed submit must come back with the form still
populated; a failed inline edit must not discard the typed value. If the mutation was optimistic, roll the
view back *and* keep the input recoverable.

No raw error codes, no stack traces, no "Something went wrong" without a next step. Say what failed, and what
to do — retry, or that someone else changed it, or that access was lost.

## Edge — the cases that actually occur

| Case | What must happen |
| --- | --- |
| Title of 300 characters | Clamps by grapheme, never breaks the row height |
| 50 assignees | Avatar group caps at 3 + `+N`, does not wrap the row |
| 200 board columns | Horizontal scroll inside the board container; the page body never scrolls sideways |
| Item deleted while open | Explain it is gone and return somewhere valid. Not a crash, not a blank panel |
| Permission lost while viewing | Same. RLS returns nothing; the UI must read that as "no longer visible", never as "empty list" |
| Offline | Say so. Do not present a stale view as live |
| Khmer with no spaces | Wraps by ICU rules, which requires the subtree to be marked `lang="km"` |

The last two rows are the ones this product gets wrong by default: an RLS-scoped query returning zero rows
looks exactly like a genuinely empty list, and unmarked Khmer text overflows its container instead of
wrapping. Distinguish deliberately in both cases.
