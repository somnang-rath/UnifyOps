import { redirect } from '@/i18n/navigation';

/**
 * `/settings` on its own.
 *
 * A redirect to the first section rather than a landing page of nine cards. The
 * nav beside it already *is* the index — a second one in the content area would
 * be the same list twice, and the click it saves is the click somebody has to
 * make anyway to reach a setting.
 *
 * §6-1 is first because §6's own table puts it first, and because it is the
 * section whose values every other screen in the product reads.
 */
export default async function SettingsIndexPage({
  params,
}: {
  params: Promise<{ locale: string; workspaceSlug: string }>;
}) {
  const { locale, workspaceSlug } = await params;
  redirect({ href: `/${workspaceSlug}/settings/general`, locale });
}
