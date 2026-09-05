import { expect, test, type Page } from '@playwright/test';

/**
 * §20.13's definition of done for slice 18, in a browser:
 *
 *   "Write a handbook page in Khmer in the company space, link it from a work
 *   item, have a colleague edit it, see both revisions and both authors, and
 *   have a stale save refused rather than merged."
 *
 * §20.14 turns three of those into checks with pass conditions, and the two that
 * genuinely need a browser are here:
 *
 *   1. "Two browsers save one page from the same base revision → the second is
 *      refused and shown both bodies; neither person's text is lost." The
 *      *statement* is asserted against real Postgres in
 *      `__tenancy__/wiki.test.ts`; what only a browser can show is that the
 *      refusal reaches a screen with both versions on it and the writer's own
 *      text still in the box.
 *   3. "A page written entirely in Khmer, read in an English workspace →
 *      diacritics render, the line-height is Khmer's, and search finds it by a
 *      two-grapheme substring." The `lang` attribute is what `:lang(km)` keys
 *      off, and it is invisible to every unit test in this repo.
 *
 * And, as with every new screen since slice 13: **every message key**. A missing
 * one renders as a raw `wiki.reader.edit` while `messages.test.ts` stays green on
 * parity — exactly how slice 10's `soon` defect and slice 13's `due` grouping
 * shipped.
 */

const PASSWORD = 'a-long-enough-password';

/*
 * Labels are matched at their **start**, never end-anchored.
 *
 * §12's field shell appends a required marker, so the label element reads
 * `Title*` while the control's accessible name is `Title` — and a `$` matches
 * nothing. The password-reset work recorded this scar and it cost the first run
 * of this spec three timeouts that named a locator rather than a cause.
 */

/** A real Khmer sentence, with the searched-for word inside a run with no spaces. */
const PHNOM_PENH = 'ភ្នំពេញ';
const KHMER_BODY = `គោលការណ៍ច្បាប់ឈប់សម្រាកសម្រាប់ការិយាល័យ${PHNOM_PENH}`;

/** `slugify`'s answer for the Latin titles this spec uses. */
const slugOf = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, '-');

function unique(prefix: string, testInfo: { project: { name: string } }): string {
  const stamp = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e7).toString(36)}`;
  return `${prefix}-${testInfo.project.name}-${stamp}`;
}

async function newWorkspace(
  page: Page,
  locale: string,
  company: string,
  email: string,
): Promise<string> {
  await page.goto(`/${locale}/sign-up`);
  await page.getByLabel(/name|ឈ្មោះ/i).fill('Wiki Owner');
  await page.getByLabel(/email|អ៊ីមែល/i).fill(email);
  await page.getByLabel(/password|ពាក្យសម្ងាត់/i).fill(PASSWORD);
  await page.getByRole('button', { name: /create account|បង្កើតគណនី/i }).click();

  await page.getByLabel(/company name|ឈ្មោះក្រុមហ៊ុន/i).fill(company);
  await page.getByRole('button', { name: /create company|បង្កើតក្រុមហ៊ុន/i }).click();

  const slug = company.toLowerCase();
  await expect(page).toHaveURL(new RegExp(`/${locale}/${slug}/invite$`));

  await page.goto(`/${locale}/${slug}/projects/new`);
  await page.getByLabel(/project name|ឈ្មោះគម្រោង/i).fill('Field Ops');
  await page.getByRole('button', { name: /create project|បង្កើតគម្រោង/i }).click();
  await expect(page).toHaveURL(
    new RegExp(`/${locale}/${slug}/projects/field-ops[?]view=board&new=1$`),
  );

  return slug;
}

/**
 * The company space's URL, resolved from the space list rather than guessed.
 *
 * Its slug is derived at signup and the company may rename it, so hard-coding
 * `/wiki/company` would be a test asserting an implementation detail of
 * `deriveSlug` from a screen that has the answer written on it.
 */
async function openCompanySpace(page: Page, locale: string, slug: string): Promise<string> {
  await page.goto(`/${locale}/${slug}/wiki`);

  const first = page.locator('main').getByRole('link').first();
  await expect(first).toBeVisible();
  await first.click();

  await expect(page).toHaveURL(new RegExp(`/${locale}/${slug}/wiki/[^/]+$`));
  return page.url();
}

test.describe('wiki', () => {
  test('writes a Khmer page, links it to an item, and reads it back', async ({
    page,
  }, testInfo) => {
    const locale = testInfo.project.name.includes('km') ? 'km' : 'en';
    const company = unique('wiki', testInfo);
    const slug = await newWorkspace(page, locale, company, `${company}@example.test`);

    /* --- an item to link to, and its real identifier ---------------------- */
    /*
     * Created first, and its identifier **read off the screen rather than
     * assumed**.
     *
     * The first draft of this spec hard-coded `ENG-1`, which is the plan's
     * running example and not this project's key: `project-key.ts` derives one
     * from the name, so "Field Ops" is not ENG. The autolink still rendered —
     * any `KEY-123` shape autolinks — so an assertion looking for a link named
     * ENG-1 passed on the *body text* while the actual link row was never
     * created, and the failure surfaced thirty lines later on the item page.
     * A test that reads the identifier cannot be wrong about it.
     */
    await page.goto(`/${locale}/${slug}/projects/field-ops?view=board`);
    const composer = page.locator('main').getByRole('textbox').first();
    await composer.fill('Rewrite the handbook');
    await composer.press('Enter');
    await expect(page.getByText('Rewrite the handbook')).toBeVisible();

    await page.goto(`/${locale}/${slug}/projects/field-ops/1`);
    const identifier = (
      await page.locator('main').getByText(/^[A-Z][A-Z0-9]*-1$/).first().innerText()
    ).trim();

    /* --- §20.3.2: write a page in the company space ----------------------- */
    await openCompanySpace(page, locale, slug);

    // §20.3.2's `[E]`: a space with no pages says so and offers the create
    // action. Both come from the catalogue, so a missing key shows here.
    await expect(
      page.getByText(/nothing written here yet|មិនទាន់មានអ្វីសរសេរនៅទីនេះទេ/i),
    ).toBeVisible();

    await page.getByRole('link', { name: /write the first page|សរសេរទំព័រដំបូង/i }).click();
    await expect(page).toHaveURL(new RegExp(`/wiki/[^/]+/new$`));

    await page.getByLabel(/^title|^ចំណងជើង/i).fill('Leave policy');
    // Written entirely in Khmer, in whatever locale this project runs — which is
    // §20.14's check 3 and §13's "Khmer is never the degraded path".
    await page.getByLabel(/^body|^ខ្លឹមសារ/i).fill(`# ${KHMER_BODY}\n\n${identifier}`);
    await page.getByRole('button', { name: /create page|បង្កើតទំព័រ/i }).click();

    /* --- the reader ------------------------------------------------------- */
    await expect(page).toHaveURL(new RegExp(`/wiki/[^/]+/leave-policy$`));
    await expect(page.getByRole('heading', { name: 'Leave policy' })).toBeVisible();

    /**
     * §20.10, and the assertion §13's oldest gap needed all along.
     *
     * The rendered body carries `lang="km"` because `hasKhmer` detected it —
     * which is what `:lang(km)`'s line-height keys off, and the difference
     * between Khmer that renders and Khmer that clips its diacritics. Asserted
     * on the attribute rather than on a computed height, because the height is a
     * consequence and the attribute is the decision.
     */
    /*
     * Scoped to the reader's `<article>`, not to `main`.
     *
     * In a Khmer locale the breadcrumb's own space name is Khmer too and
     * carries the same attribute, so `main [lang="km"]` first matched
     * "ក្រុមហ៊ុន" — which is the `lang` fix working on a *second* element and
     * the test being imprecise about which one it meant.
     */
    const body = page.locator('article [lang="km"]').first();
    await expect(body).toBeVisible();
    await expect(body).toContainText(PHNOM_PENH);

    /**
     * §20.7's `ENG-142` autolink, and **where it points is the assertion**.
     *
     * It resolves through §7.9's search short-circuit rather than a constructed
     * direct link, because "a direct link needs the project's *slug* and a body
     * only carries its key" — and because the search screen is the only version
     * that is correct for an identifier that does not resolve. A constructed
     * link would 404; this says "No item FO-1".
     *
     * `exact` matters: the link panel below names the same item as
     * "FO-1 Rewrite the handbook", and an inexact match finds both.
     */
    await expect(
      page.getByRole('link', { name: identifier, exact: true }),
    ).toHaveAttribute('href', new RegExp(`/search\\?q=${identifier}$`));

    /* --- §20.2: the link, made by writing the identifier ------------------ */
    /*
     * **Nothing was clicked to create this**, and that is the assertion.
     *
     * `syncOutboundLinks` reads the `FO-1` in the body on save and links the
     * page to the item it names — so a writer who mentions a task in a sentence
     * gets the item's "Pages" panel for free, which is §20.15's mitigation for
     * the feature's usual fate: "a page reached from work is a page that gets
     * read". The explicit field below is for the item a page is *about* rather
     * than one it happens to mention.
     */
    await expect(
      page.getByRole('link', { name: new RegExp(`${identifier}\\s+Rewrite the handbook`) }),
    ).toBeVisible();

    // Linking the same item again is one row, not two (§20.4's unique), and the
    // form reports nothing to undo rather than an error somebody has to read.
    await page.getByLabel(/link a work item|ភ្ជាប់កិច្ចការ/i).fill(identifier);
    await page.getByRole('button', { name: /^link$|^ភ្ជាប់$/i }).click();
    await expect(page.getByRole('button', { name: /^link$|^ភ្ជាប់$/i })).toBeEnabled();
    await expect(
      page.getByRole('link', { name: new RegExp(`${identifier}\\s+Rewrite the handbook`) }),
    ).toHaveCount(1);

    // §20.2's other half — "an item lists its pages" — is what makes the wiki
    // get read, so it is asserted from the item's side as well.
    await page.goto(`/${locale}/${slug}/projects/field-ops/1`);
    await expect(page.getByRole('heading', { name: /^pages$|^ទំព័រ$/i })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Leave policy' })).toBeVisible();

    /* --- §20.14 check 3: found by a two-grapheme Khmer substring ---------- */
    // A substring *inside* a run with no spaces, which is the whole reason §13
    // routes Khmer to trigram rather than to full text: `to_tsvector` sees one
    // enormous token and only that whole string could ever match it.
    const inside = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(
      PHNOM_PENH,
    )]
      .map((segment) => segment.segment)
      .slice(1, 3)
      .join('');

    await page.goto(`/${locale}/${slug}/search?q=${encodeURIComponent(inside)}`);
    await expect(page.getByRole('heading', { name: /^pages$|^ទំព័រ$/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /Leave policy/ })).toBeVisible();

  });

  /**
   * §20.14's first check, and §20.3.3's whole argument.
   *
   * Two tabs rather than two accounts, and §20.3.3 says why that is not a
   * shortcut: "`[!]` the same person in two tabs → still refused, and the
   * message says so plainly rather than blaming a colleague who does not
   * exist." The mechanism is the revision number, not the identity, so the
   * cheaper setup exercises exactly the same path — and it also pins the edge
   * case the plan calls out.
   */
  test('refuses a stale save and shows both bodies', async ({ page, context }, testInfo) => {
    const locale = testInfo.project.name.includes('km') ? 'km' : 'en';
    const company = unique('stale', testInfo);
    const slug = await newWorkspace(page, locale, company, `${company}@example.test`);

    await openCompanySpace(page, locale, slug);
    await page.getByRole('link', { name: /write the first page|សរសេរទំព័រដំបូង/i }).click();
    await page.getByLabel(/^title|^ចំណងជើង/i).fill('Shared page');
    await page.getByLabel(/^body|^ខ្លឹមសារ/i).fill('the original line');
    await page.getByRole('button', { name: /create page|បង្កើតទំព័រ/i }).click();
    await expect(page).toHaveURL(new RegExp('/wiki/[^/]+/shared-page$'));

    const editorUrl = `${page.url()}/edit`;

    // Both tabs load the editor at revision 1.
    const second = await context.newPage();
    await page.goto(editorUrl);
    await second.goto(editorUrl);

    const bodyOf = (target: Page) => target.getByLabel(/^body|^ខ្លឹមសារ/i);
    const saveOf = (target: Page) => target.getByRole('button', { name: /^save$|^រក្សាទុក$/i });

    // The first writer wins.
    await bodyOf(second).fill('their paragraph');
    await saveOf(second).click();
    // Slice 8's rule, and slice 15's scar: wait for the control that owns the
    // mutation to re-enable itself before doing anything else, or the next
    // action races a server action still in flight.
    await expect(saveOf(second)).toBeEnabled();
    await expect(second.getByText(/revision 2|កំណែទី 2/i)).toBeVisible();

    // The second writer is refused — not merged, and not silently overwritten.
    await bodyOf(page).fill('my paragraph');
    await saveOf(page).click();
    await expect(saveOf(page)).toBeEnabled();

    await expect(
      page.getByText(/somebody else saved this page|មានអ្នកផ្សេងបានរក្សាទុកទំព័រនេះ/i),
    ).toBeVisible();

    /**
     * §20.3.3: "their words are never discarded and never merged."
     *
     * Both halves are on screen — the writer's own text still in the box, and
     * the version that landed in the comparison beside it. This is the assertion
     * that would fail if somebody rebuilt the refusal as a toast.
     */
    await expect(bodyOf(page)).toHaveValue('my paragraph');
    await expect(page.getByText('their paragraph')).toBeVisible();

    // "Keep mine" rebases rather than forces: their revision is kept in the
    // history and the next save lands on top of it.
    await page.getByRole('button', { name: /keep mine|រក្សាកំណែរបស់ខ្ញុំ/i }).click();
    await saveOf(page).click();
    await expect(saveOf(page)).toBeEnabled();
    await expect(page.getByText(/revision 3|កំណែទី 3/i)).toBeVisible();

    /* --- §20.2's history: both revisions, both bodies, both authors -------- */
    await page.goto(`${editorUrl.replace('/edit', '')}/history`);

    // Three revisions: the create, their save, and the rebase. Nothing was ever
    // removed, which is what makes the history worth having (§20.4).
    await expect(page.getByText(/revision 1|កំណែទី 1/i)).toBeVisible();
    await expect(page.getByText(/revision 2|កំណែទី 2/i)).toBeVisible();
    await expect(page.getByText(/revision 3|កំណែទី 3/i)).toBeVisible();

    await second.close();
  });

  /**
   * §20.3.6, and the rule `deleteCycle` and `work_item_state_fk` already follow:
   * "deleting a container must never decide the fate of what is inside it."
   */
  test('reparents a deleted page’s children rather than deleting them', async ({
    page,
  }, testInfo) => {
    const locale = testInfo.project.name.includes('km') ? 'km' : 'en';
    const company = unique('reparent', testInfo);
    const slug = await newWorkspace(page, locale, company, `${company}@example.test`);

    const spaceUrl = await openCompanySpace(page, locale, slug);

    const createPage = async (title: string, parent?: string) => {
      await page.goto(`${spaceUrl}/new`);
      await page.getByLabel(/^title|^ចំណងជើង/i).fill(title);
      if (parent) {
        // The option's own text carries the depth indent, so the label is
        // matched by its trimmed value rather than by equality.
        await page.getByLabel(/^inside|^នៅក្នុង/i).selectOption({ label: parent });
      }
      await page.getByRole('button', { name: /create page|បង្កើតទំព័រ/i }).click();
      // Anchored on the *reader*, not on any two-segment path: `/wiki/company/new`
      // matches `[^/]+/[^/]+$` too, so the looser pattern would let a refused
      // create through and fail thirty lines later naming the sidebar.
      await expect(page).toHaveURL(new RegExp(`/wiki/[^/]+/${slugOf(title)}$`));
    };

    await createPage('Parent page');
    await createPage('Child page', 'Parent page');

    // The sidebar shows both, nested.
    await page.goto(spaceUrl);
    await expect(page.getByRole('link', { name: 'Parent page' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Child page' })).toBeVisible();

    // Deleting the parent leaves the child reachable at the top level rather
    // than taking it along.
    await page.goto(`${spaceUrl}/parent-page`);
    await page.getByRole('button', { name: /delete page|លុបទំព័រ/i }).click();
    const confirm = page.getByRole('button', { name: /^delete$|^លុប$/i });
    await confirm.click();

    /*
     * Slice 8's rule — wait for the mutation to land before navigating, or
     * `page.goto` aborts the server action mid-flight and the delete silently
     * does not happen.
     *
     * **The confirm button disappearing is not that signal, and believing it was
     * cost an afternoon.** This spec used to wait on `expect(confirm)
     * .toHaveCount(0)` with a comment reasoning that "the route 404s in place,
     * so the button is gone rather than enabled — its disappearance is the
     * commit." The premise is wrong: the dialog closes on **submit**, client
     * side, before the action has resolved, so the wait returned while the
     * delete was still in flight and `page.goto` then aborted it. It passed for
     * two slices because the window was narrow, and it began failing when the
     * page grew two queries — which is exactly how a latent race announces
     * itself.
     *
     * The honest signal is the one the *server* produces: the action revalidates
     * the wiki, `getPage` no longer finds a deleted page, and the reader 404s in
     * place. **The page's own heading going away is the commit.**
     */
    await expect(page.getByRole('heading', { name: 'Parent page' })).toHaveCount(0);

    await page.goto(spaceUrl);
    await expect(page.getByRole('link', { name: 'Parent page' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Child page' })).toBeVisible();
  });
});
