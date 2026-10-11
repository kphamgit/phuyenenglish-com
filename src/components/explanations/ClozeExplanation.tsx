import { useMemo } from "react";
import type { QuestionAttemptAssesmentResultsProps } from "../shared/types";
import { parseClozeContent } from "./clozeUtils";

type Props = {
  content: string;
  processQuestionResults?: QuestionAttemptAssesmentResultsProps
  // "answer_key": fill blanks with the correct answers (default)
  // "user_answer": fill blanks with the user's answers, wrong ones in red with a strike through
  mode?: "answer_key" | "user_answer";
};

const ClozeExplanation = ({ content,  processQuestionResults, mode = "answer_key" }: Props) => {

  // Rebuild each sentence with the user's answers in the blanks
  const sentences = useMemo(
    () => parseClozeContent(content, processQuestionResults?.cloze_question_results),
    [content, processQuestionResults]
  );

  // if answer_key is "who*that", display "who / that"
  const renderAnswerKey = (answer_key: string, keyPrefix: string) =>
    answer_key.split('*').map((option, i, array) => (
      <span key={`${keyPrefix}-${i}`}>
        {option.trim()}
        {i < array.length - 1 && <span className="text-blue-600"> / </span>}
      </span>
    ));

  return (
    <>
      {sentences.map((parts, sentenceIndex) => (
        <div key={sentenceIndex} className="mt-3 text-green-700">
          {parts.map((field, partIndex) => {
            const key = `${sentenceIndex}-${partIndex}`;
            if (field.type === 'static_text') {
              return <span key={key}>{field.value}</span>;
            }
            if (mode === "answer_key") {
              return (
                <span key={key} className="text-blue-800 font-bold">{renderAnswerKey(field.answer_key ?? "", key)}</span>
              );
            }
            return (
              <span key={key} className={field.error ? "text-red-700 font-bold line-through" : "text-blue-800 font-bold"}>
                {field.value || "___"}
              </span>
            );
          })}
        </div>
      ))}
    </>
  )
};
export default ClozeExplanation;
