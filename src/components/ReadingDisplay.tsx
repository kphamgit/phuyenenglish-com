import { useEffect, useRef } from 'react';
import DOMPurify from 'dompurify';

// A vocabulary word the teacher tied to a dictionary sense in the reading
// (saved as <span data-sense-id="812" class="sense-word">farmers</span>).
export interface SenseWord {
  text: string;
  sense_id: number;
}

// Renders a quiz's "reading" HTML (authored in the teacher app's TipTap editor).
// We don't try to match the teacher layout exactly — we just keep images INLINE so they
// flow with the text rather than sitting on their own block. The teacher-side image node is
// already inline, so the saved HTML has <img> inside the paragraphs; we only need to (a) let
// the sanitizer keep the image src + inline sizing, and (b) ensure the <img> renders inline.
// When `onSenseWordClick` is given, the teacher's vocabulary words become clickable.
export default function ReadingDisplay({
  html,
  onSenseWordClick,
}: {
  html?: string | null;
  onSenseWordClick?: (word: SenseWord) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const clickable = !!onSenseWordClick;

  const clean = html && html.trim()
    ? DOMPurify.sanitize(html, {
        ALLOWED_TAGS: ['p', 'b', 'i', 'em', 'strong', 'u', 's', 'a', 'ul', 'ol', 'li', 'br',
          'span', 'div', 'img', 'h1', 'h2', 'h3', 'figure', 'figcaption'],
        // Keep `src` (so images show), `style`/`width`/`height` (so sizing from the editor survives),
        // and `data-sense-id` (the vocabulary words).
        ALLOWED_ATTR: ['href', 'target', 'rel', 'src', 'alt', 'title', 'style', 'width', 'height', 'class',
          'data-sense-id'],
      })
    : '';

  // Make the vocabulary words reachable and usable from the keyboard, like buttons.
  useEffect(() => {
    if (!clickable || !containerRef.current) return;
    containerRef.current.querySelectorAll<HTMLElement>('[data-sense-id]').forEach((el) => {
      el.setAttribute('role', 'button');
      el.setAttribute('tabindex', '0');
    });
  }, [clean, clickable]);

  if (!clean) return null;

  // One handler on the container for all words (the words are plain HTML, not React elements).
  const senseWordFrom = (target: EventTarget): SenseWord | null => {
    const el = (target as HTMLElement).closest?.('[data-sense-id]') as HTMLElement | null;
    if (!el || !containerRef.current?.contains(el)) return null;
    const senseId = Number(el.dataset.senseId);
    if (!Number.isInteger(senseId) || senseId <= 0) return null;
    return { text: (el.textContent ?? '').trim(), sense_id: senseId };
  };

  const handleClick = (e: React.MouseEvent) => {
    const word = onSenseWordClick && senseWordFrom(e.target);
    if (word) onSenseWordClick(word);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const word = onSenseWordClick && senseWordFrom(e.target);
    if (word) {
      e.preventDefault();
      onSenseWordClick(word);
    }
  };

  return (
    <>
      {/* Float images so the text flows around them over several lines (hugged to one side),
          rather than each image sitting on its own block. The ::after clearfix makes the
          container wrap its floated images so following content isn't pulled up beside them. */}
      <style>{`
        .reading-content::after { content: ""; display: block; clear: both; }
        .reading-content img {
          float: left;
          max-width: 45%;
          height: auto;
          margin: 4px 14px 6px 0;
        }
        .reading-content.clickable .sense-word {
          text-decoration: underline;
          text-underline-offset: 3px;
          cursor: pointer;
          border-radius: 3px;
        }
        .reading-content.clickable .sense-word:hover,
        .reading-content.clickable .sense-word:focus-visible {
          background-color: #dbeafe;
          outline: none;
        }
      `}</style>
      <div
        ref={containerRef}
        className={`reading-content${clickable ? ' clickable' : ''}`}
        onClick={clickable ? handleClick : undefined}
        onKeyDown={clickable ? handleKeyDown : undefined}
        dangerouslySetInnerHTML={{ __html: clean }}
      />
    </>
  );
}
