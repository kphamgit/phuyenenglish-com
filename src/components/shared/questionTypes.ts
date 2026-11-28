// The name of each question format, as the teacher app (phuyenenglish.net, New Question) calls it.
// Shown with the question number on the quiz screens.
export const QUESTION_TYPE_NAMES: Record<number, string> = {
  1: 'Cloze',
  2: 'Button Cloze Select',
  3: 'Button Select',
  4: 'Radio',
  5: 'Checkbox',
  6: 'Word Scramble',
  7: 'Speech Recognition',
  8: 'Word Select',
  9: 'Shadowing',
  10: 'Drop Down',
  11: 'Letter Cloze',
  12: 'Sentence Scramble',
  13: 'Writing',
  14: 'Speaking',
};

// "Shadowing", or "" for a format with no name.
export const questionTypeName = (format: number | undefined | null) =>
  format == null ? '' : QUESTION_TYPE_NAMES[format] ?? '';
