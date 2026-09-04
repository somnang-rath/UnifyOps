/**
 * §6-7's logo in the workspace header.
 *
 * A plain `<img>` rather than `next/image`, and it is the same call
 * `attachment-list.tsx` makes for a preview: the source is a **signed,
 * short-lived URL** from our own object store, and `next/image` would proxy it
 * through the optimizer and cache a URL that expires in ten minutes — so the
 * cached copy outlives the credential and starts serving a 403 to everybody.
 *
 * `aria-hidden`, because the company's name is right beside it in the same
 * link. A logo that is both an image and a redundant label reads twice to a
 * screen reader — the rule the `design-tokens` skill states for the product's
 * own mark, applied to a company's.
 *
 * A server component: it has no interaction at all, and the only reason it is a
 * component rather than four lines in the layout is that the eslint disable and
 * the reasoning above belong somewhere they will be read.
 */
export function WorkspaceLogo({ src, name }: { src: string; name: string }) {
  return (
    // A signed URL that expires must not be cached by the image optimizer — see
    // the note above.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      aria-hidden
      // Sized in both dimensions so the header cannot reflow when the image
      // arrives, whatever aspect ratio the company uploaded; `object-contain`
      // keeps a wide wordmark and a square mark both intact.
      width={24}
      height={24}
      className="size-6 shrink-0 object-contain"
      // The name is the fallback in the one case an `alt` would have served:
      // a broken URL leaves the text beside it, which already says the company.
      data-workspace={name}
    />
  );
}
