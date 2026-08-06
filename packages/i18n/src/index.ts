/**
 * @prism/i18n — the locale runtime for web, admin, and space (ADR 0016).
 *
 * Deliberately small: locale identity + a translator + `Intl` wrappers. It is
 * *not* imported by `packages/ui`, which takes its text as props (§2.5).
 */
export * from './locale';
export * from './translator';
export * from './format';
export * from './provider';
export { en } from './messages/en';
export { km } from './messages/km';
