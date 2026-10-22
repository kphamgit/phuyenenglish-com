import { type ReactNode } from "react";

// Shared rendering for a Vietnamese-encoded pronunciation (viet_pron_code), used by
// the word-lookup results panel AND the student's SR prompt, so both show weak parts
// — (h), (r), (v), and trailing combos — in the same small/brown style.

// Trailing combos that render smaller when a syllable IS exactly this combo (hyphen
// in front) at the end of a WORD, e.g. "fái-ờn", "tái-ờm", "bô-ồ". The leading hyphen
// stays normal; only the combo shrinks.
const SMALL_TAILS = ["ần", "ờm", "ồ", "ờn", "ừm"];
// Weak parts to de-emphasize (small + dark brown) wherever they appear mid-string. Each rule finds
// `match`; the first `keep` characters render normally and the remainder renders de-emphasized
// (keep = 0 shrinks the whole match). Optional `show` overrides the de-emphasized
// text — e.g. match "(h)" but display just "h" (drop the parentheses).
// TO UNDO the parentheses removal: delete `show: "h"` from the "(h)" rule below.
const SMALL_MIDDLES: { match: string; keep: number; show?: string }[] = [
  { match: "-ần-", keep: 0 },
  { match: "-ờm-", keep: 0 },
  { match: "-ờn-", keep: 0 },   // e.g. "réi-ờn-jhờ(r)" (ranger); word-final "-ờn" is in SMALL_TAILS
  { match: "(h)", keep: 0, show: "h" },   // aspiration mark: t(h), p(h), k(h) from the backend
  { match: "(r)", keep: 0 },   // e.g. "quố-đờ(r)": the whole "(r)" shrinks
  { match: "(v)", keep: 0 },   // the whole "(v)" shrinks, like "(r)"
];

// A trailing combo counts as word-final when the next char is the end of the string,
// whitespace, or any non-letter EXCEPT a hyphen (a hyphen means another syllable
// follows, so it's mid-word, not a tail). This lets a tail shrink even when the
// pronunciation is embedded in a sentence or wrapped in "/.../".
const isTailBoundary = (ch: string | undefined): boolean =>
  ch === undefined || (ch !== "-" && !/\p{L}/u.test(ch));

// Render a string that may contain one or more Vietnamese pronunciations, de-emphasizing:
//  - a middle marker from SMALL_MIDDLES (e.g. "-ần-", "(r)", or the "(h)" in "t(h)" / "k(h)"), small + brown,
//  - a trailing combo from SMALL_TAILS at the end of a word (e.g. "-ồ" / "-ờn"), small.
export const renderVietPron = (raw: string): ReactNode => {
  const s = raw.normalize("NFC");
  const nodes: ReactNode[] = [];
  let i = 0;
  let k = 0;

  // Earliest middle marker at/after `from`.
  const nextMiddle = (from: number): { at: number; rule: (typeof SMALL_MIDDLES)[number] } | null => {
    let best: { at: number; rule: (typeof SMALL_MIDDLES)[number] } | null = null;
    for (const rule of SMALL_MIDDLES) {
      const at = s.indexOf(rule.match, from);
      if (at !== -1 && (best === null || at < best.at)) best = { at, rule };
    }
    return best;
  };

  // Earliest word-final tail "-<combo>" at/after `from`.
  const nextTail = (from: number): { at: number; combo: string } | null => {
    let best: { at: number; combo: string } | null = null;
    for (const combo of SMALL_TAILS) {
      const needle = "-" + combo;
      let at = s.indexOf(needle, from);
      while (at !== -1 && !isTailBoundary(s[at + needle.length])) {
        at = s.indexOf(needle, at + 1);
      }
      if (at !== -1 && (best === null || at < best.at)) best = { at, combo };
    }
    return best;
  };

  while (i < s.length) {
    const m = nextMiddle(i);
    const t = nextTail(i);
    // Pick whichever matches earliest (middle wins ties; they never start at the same index).
    const useMiddle = m !== null && (t === null || m.at <= t.at);
    const useTail = !useMiddle && t !== null;

    if (useMiddle && m) {
      if (m.at + m.rule.keep > i) nodes.push(s.slice(i, m.at + m.rule.keep));
      nodes.push(
        <span key={`m${k++}`} className="text-[0.8em] text-[#5a3825]">
          {m.rule.show ?? m.rule.match.slice(m.rule.keep)}
        </span>
      );
      i = m.at + m.rule.match.length;
    } else if (useTail && t) {
      // Everything up to and including the leading hyphen stays normal; the combo shrinks.
      nodes.push(s.slice(i, t.at + 1));
      nodes.push(
        <span key={`t${k++}`} className="text-[0.8em]">{t.combo}</span>
      );
      i = t.at + 1 + t.combo.length;
    } else {
      nodes.push(s.slice(i));
      break;
    }
  }

  return <>{nodes}</>;
};
