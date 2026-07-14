/**
 * @prism/editor/server — framework-free entry for Node consumers (the live
 * server's snapshot hook). Exposes ONLY the pure Tiptap schema so importing it
 * never pulls React / the provider into a server bundle.
 */
export { editorExtensions, generateWikiHTML } from './extensions';
