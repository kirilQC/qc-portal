// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";

/**
 * Text that writes itself in on load, word by word, with a caret that blinks at the end and then goes.
 *
 * It keeps the markup it is given — bold figures stay bold, a quieter trailing sentence stays quiet —
 * by walking the children and wrapping each word in its own span with a staggered animation delay. All
 * the words are in the DOM from the first paint, so a screen reader, a copy-paste or a search reads the
 * whole sentence straight away; only their appearance is staggered. Reduced motion shows it at once.
 * Remount it (a new `key`) to type it again, e.g. when the range changes.
 */
const STEP = 0.055; // seconds between words

export default function TypedText({ children }: { children: ReactNode }) {
  let index = 0;

  const walk = (node: ReactNode): ReactNode => {
    if (typeof node === "string" || typeof node === "number") {
      return String(node).split(/(\s+)/).map((part, i) => {
        if (!part) return null;
        if (/^\s+$/.test(part)) return part;
        const delay = `${(index++ * STEP).toFixed(3)}s`;
        return <span key={i} className="typed-word" style={{ animationDelay: delay }}>{part}</span>;
      });
    }
    if (Array.isArray(node)) return Children.map(node, walk);
    if (isValidElement(node)) {
      const element = node as ReactElement<{ children?: ReactNode }>;
      return element.props.children === undefined ? element : cloneElement(element, undefined, walk(element.props.children));
    }
    return node;
  };

  const content = walk(children);
  const total = index * STEP;
  return (
    <>
      {content}
      <span className="typed-caret" style={{ animationDelay: `0s, ${(total + 0.9).toFixed(2)}s` }} aria-hidden="true" />
    </>
  );
}
