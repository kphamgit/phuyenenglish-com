export interface ClozeQuestionResultsContent {
  user_answer: string,
  answer_key: string,
  score: number,
  error_flag: boolean,
}

export interface ExplanationPart {
  type: "static_text" | "blank";
  value: string;          // static text, or the user's answer for a blank
  answer_key?: string;    // blanks only
  error?: boolean;        // blanks only
}

// Split cloze content into sentences (separated by '/'), each a list of parts.
// Results from the backend are in blank order, so blanks are matched by position
// (the n-th bracketed part in content <-> the n-th entry in results).
export const parseClozeContent = (
  content: string | undefined,
  results: ClozeQuestionResultsContent[] = [],
): ExplanationPart[][] => {
  let blankIndex = 0;   // runs across all sentences
  return (content ?? "").split('/').map((sentence) =>
    // after splitting on brackets, odd-indexed parts are the blanks
    sentence.split(/\[|\]/).flatMap((part, i): ExplanationPart[] => {
      if (i % 2 === 0) {
        return part === "" ? [] : [{ type: "static_text", value: part }];
      }
      const result = results[blankIndex++];
      return [{
        type: "blank",
        value: result?.user_answer ?? "",
        answer_key: result?.answer_key ?? part,
        error: result?.error_flag,
      }];
    })
  );
};

// Plain-text sentences with the user's answers filled into the blanks
// e.g. "I [am] a student." + user_answer "is" -> "I is a student."
export const buildClozeUserSentences = (
  content: string | undefined,
  results: ClozeQuestionResultsContent[] = [],
): string[] =>
  parseClozeContent(content, results).map((parts) =>
    parts.map((part) => part.value).join("").trim()
  );
