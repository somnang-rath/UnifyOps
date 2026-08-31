import { hasLocale } from 'next-intl';
import { getRequestConfig } from 'next-intl/server';
import { routing } from './routing';

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;

  return {
    locale,
    messages: (await import(`./messages/${locale}.json`)).default,
    formats: {
      // Khmer locale otherwise renders Khmer digits (០១២៣). Users
      // overwhelmingly expect Latin digits in a task list, so pin it.
      number: {
        default: { numberingSystem: 'latn' },
      },
      dateTime: {
        short: { day: 'numeric', month: 'short', numberingSystem: 'latn' },
        long: { day: 'numeric', month: 'long', year: 'numeric', numberingSystem: 'latn' },
      },
    },
  };
});
