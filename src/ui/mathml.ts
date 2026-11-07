// MathML builders (Electron's Chromium renders MathML natively, so no math library is needed).
import { ml } from './dom';

export const mi = (t: string): Element => ml('mi', {}, t);
export const mn = (t: string | number): Element => ml('mn', {}, String(t));
export const mo = (t: string): Element => ml('mo', {}, t);
export const mrow = (...c: Element[]): Element => ml('mrow', {}, ...c);
export const mfrac = (a: Element, b: Element): Element => ml('mfrac', {}, a, b);
export const msub = (a: Element, b: Element): Element => ml('msub', {}, a, b);
export const mtext = (t: string): Element => ml('mtext', {}, t);

/** d(X)/dt as a MathML fraction. */
export const ddt = (x: string): Element => mfrac(mrow(mi('d'), mi(x)), mrow(mi('d'), mi('t')));

/** A block <math> element containing one equation row. */
export function equation(...parts: Element[]): Element {
  return ml('math', { display: 'block' }, mrow(...parts));
}
