import { useEffect, useState } from "react";
import api from "../../api";
import type { QuestionAttemptAssesmentResultsProps } from "../shared/types";
import { buildClozeUserSentences } from "./clozeUtils";

interface GrammarCheckResult {
  status: "correct" | "incorrect" | "";
  wrong: string;    // the incorrect English word/phrase ("" if correct)
  fix: string;      // the corrected English word/phrase ("" if correct)
  reason: string;   // explanation, in Vietnamese by default
  provider: string;
  error?: string;
}

// Same cue presets as the teacher app's grammar-check (NewQuestion), all of them selected.
// They're joined into one comma-separated 'cue' string, like the teacher app does.
const GRAMMAR_CUES = [
  'be-verb', 'verb tenses', 'subject-verb agreement', 'word usage', 'spelling',
  'articles', 'prepositions', 'noun clauses', 'adjective clauses',
].join(', ');

type Props = {
  content: string;
  processQuestionResults?: QuestionAttemptAssesmentResultsProps;
};

// Sends the user's reconstructed sentence to /api/grammar-check/ and shows the analysis.
// Only used when the cloze answer is wrong.
const ClozeGrammarCheck = ({ content, processQuestionResults }: Props) => {
  const sentence = buildClozeUserSentences(content, processQuestionResults?.cloze_question_results).join(" ");

  // keep the sentence the result belongs to, so a new sentence shows "loading" without a reset
  const [fix, setFix] = useState<{ sentence: string; result: GrammarCheckResult | null } | null>(null);

  useEffect(() => {
    if (!sentence) return;
    let cancelled = false;
    api.post<GrammarCheckResult>("/api/grammar-check/", {
      sentence,
      cue: GRAMMAR_CUES,
      language: "vi",
      provider: "openai",   // 'openai' (ChatGPT) or 'gemini'
    })
      .then((res) => { if (!cancelled) setFix({ sentence, result: res.data }); })
      .catch((err) => {
        console.error("grammar-check failed:", err);
        if (!cancelled) setFix({ sentence, result: null });
      });
    return () => { cancelled = true; };
  }, [sentence]);

  if (!sentence) return null;

  const loading = fix?.sentence !== sentence;
  const result = loading ? null : fix?.result;

  return (
    <div className="mt-3 text-left text-gray-700">
      <span className="font-semibold">Analysis: </span>
      {loading && <div className="italic text-gray-500">Analyzing…</div>}
      {!loading && !result && <div className="italic text-gray-500">Analysis is not available right now.</div>}
      {result && (
        <>
          {result.status === "incorrect" && result.wrong && (
            <div className="font-bold">
              <span className="text-red-700 line-through">{result.wrong}</span>
              {result.fix && <> → <span className="text-blue-800">{result.fix}</span></>}
            </div>
          )}
          <div className="mt-1">{result.reason}</div>
        </>
      )}
    </div>
  );
};
export default ClozeGrammarCheck;
