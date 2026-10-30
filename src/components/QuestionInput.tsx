import type { ChildRef } from './TakeQuiz';
import type { QuestionProps } from './shared/types';
import { DynamicWordInputs } from './questions/DynamicWordInputs';
import { ButtonSelectCloze } from './questions/ButtonSelectCloze';
import { ButtonSelect } from './questions/ButtonSelect';
import { RadioQuestion } from './questions/RadioQuestion';
import { CheckboxQuestion } from './questions/CheckboxQuestion';
import DragDrop from './questions/dragdrop/DragDrop';
import SRNonContinuous from './questions/SRNonContinuous';
import { WordsSelect } from './questions/WordsSelect';
import { DropDowns } from './questions/DropDowns';
import SentenceScramble from './questions/SentenceScramble';
import WritingQuestion from './questions/WritingQuestion';

interface QuestionInputProps {
  question: QuestionProps;
  ref: React.Ref<ChildRef>;    // forwarded to the active question component (exposes getAnswer)
  submitted?: boolean;         // only used by ButtonSelectCloze (format 2)
}

/**
 * Renders the correct interactive question component for a question's `format`.
 * Shared by TakeQuiz / TakeVideoQuiz (and can be used by the live variants too).
 * The caller supplies a `key` (e.g. the question-attempt id) when it wants a fresh
 * input per question.
 */
export default function QuestionInput({ question, ref, submitted }: QuestionInputProps) {
  const content = question.content;
  const content_language = question.content_language ?? 'en';

  switch (question.format) {
    case 1:
      return <DynamicWordInputs content={content} ref={ref} />;
    case 2:
      return (
        <ButtonSelectCloze
          content={content}
          content_language={content_language}
          choices={question.button_cloze_options}
          submitted={submitted}
          ref={ref}
        />
      );
    case 3:
      return <ButtonSelect content={content} ref={ref} />;
    case 4:
      return <RadioQuestion content={content} ref={ref} />;
    case 5:
      return <CheckboxQuestion content={content} ref={ref} />;
    case 6:
      return <DragDrop content={content} content_language={content_language} ref={ref} />;
    case 7:
      return <SRNonContinuous content={content} ref={ref} />;
    case 8:
      return <WordsSelect content={content} ref={ref} />;
    case 10:
      return <DropDowns content={content} ref={ref} />;
    case 12:
      return <SentenceScramble content={content} ref={ref} />;
    case 13:
      return <WritingQuestion content={content} ref={ref} />;
    default:
      return null;
  }
}
