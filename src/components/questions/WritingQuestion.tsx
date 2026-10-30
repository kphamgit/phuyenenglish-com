import { useImperativeHandle, useState } from 'react';
import type { ChildRef } from '../TakeQuiz';

interface WritingQuestionProps {
  content: string;  // the text the student edits (e.g. a paragraph with mistakes to fix)
  ref: React.Ref<ChildRef>;
}

// Writing question (format 13): the content starts in an editable textarea; the student edits it,
// and on Submit the edited text is the answer, graded against the answer key on the server.
export default function WritingQuestion({ content, ref }: WritingQuestionProps) {
  const [text, setText] = useState(content ?? '');
  // Start over when a new question arrives. TakeQuiz remounts this per question (via `key`), but
  // the live quiz pages don't, so reset here when the content changes.
  const [shownContent, setShownContent] = useState(content);
  if (content !== shownContent) {
    setShownContent(content);
    setText(content ?? '');
  }

  useImperativeHandle(ref, () => ({
    getAnswer: () => text,
  }));

  return (
    <textarea
      // Explicit width: the quiz pages center their content with flexbox, so the wrapper shrinks to
      // fit and `w-full` alone stays narrow. Up to 48rem wide, never wider than the screen.
      className="w-[min(48rem,calc(100vw-3rem))] min-h-48 p-3 text-lg text-black bg-white border-2 border-gray-300 rounded-md resize-y focus:border-indigo-500 focus:outline-none"
      aria-label="Your writing"
      spellCheck={false}
      value={text}
      onChange={(e) => setText(e.target.value)}
    />
  );
}
