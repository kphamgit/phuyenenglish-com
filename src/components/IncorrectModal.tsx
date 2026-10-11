
import { useEffect, useRef, useState } from "react";
import ClozeExplanation from "./explanations/ClozeExplanation";
import ClozeGrammarCheck from "./explanations/ClozeGrammarCheck";
import Explanation from "./explanations/Explanation";
import {type QuestionAttemptAssesmentResultsProps} from "./shared/types"
import ButtonSelectExplanation from "./explanations/ButtonSelectExplanation";
import RadioExplanation from "./explanations/RadioExplanation";
import CheckboxExplanation from "./explanations/CheckboxExplanation";
import WordScrambleExplanation from "./explanations/WordScrambleExplanation";
import WordsSelect from "./explanations/WordsSelect";
import DropDown from "./explanations/DropDown";
import SentenceScramble from "./explanations/SentenceScramble";
import SRExplanation from "./explanations/SRExplanation";


export interface Props {
    parentCallback: (action: string ) => void;
    format: number;
    answer_key: string;
    content: string;
    explanation?: string;
    processQuestionResults?: QuestionAttemptAssesmentResultsProps;
}

function IncorrectModal({ parentCallback, format, answer_key, content, explanation,  processQuestionResults }: Props) {

    const [timeLeft, setTimeLeft] = useState(10);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    useEffect(() => {
        timerRef.current = setInterval(() => {
            // Keep the updater pure — just decrement. Don't call parentCallback here:
            // updater functions run during render, and parentCallback is a useEffectEvent
            // which React forbids calling during rendering.
            setTimeLeft(prev => (prev <= 1 ? 0 : prev - 1));
        }, 2000);
        return () => clearInterval(timerRef.current!);
    }, []);

    // When the countdown reaches 0, stop the timer and notify the parent (from an effect,
    // which is a valid place to call a useEffectEvent).
    useEffect(() => {
        if (timeLeft === 0) {
            clearInterval(timerRef.current!);
            parentCallback('');
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [timeLeft]);

    const handleCloseModal = () => {
        clearInterval(timerRef.current!);
        parentCallback('');
    }

  return (

    <div className="bg-white rounded-lg shadow-xl p-6 w-auto max-w-md max-h-[80vh] overflow-y-auto text-center">
        <div className="mb-4 font-bold text-lg text-red-700">Score: {processQuestionResults?.score}</div>
        <Explanation>
            {(format === 1 || format == 2 ) && 
                <ClozeExplanation  content={content} processQuestionResults={processQuestionResults} />}
            {(format === 1 || format === 2) &&
                <div className="mt-3 text-left text-gray-700">
                    <span className="font-semibold">Your answer: </span>
                    <ClozeExplanation content={content} processQuestionResults={processQuestionResults} mode="user_answer" />
                </div>}
            {(format === 1 || format === 2) && processQuestionResults?.error_flag &&
                <ClozeGrammarCheck content={content} processQuestionResults={processQuestionResults} />}
            {format === 3 && <ButtonSelectExplanation content={content} answer_key={answer_key} processQuestionResults={processQuestionResults} />}
            {format === 4 && <RadioExplanation content={content} answer_key={answer_key} processQuestionResults={processQuestionResults} />}
            {format === 5 && <CheckboxExplanation content={content} answer_key={answer_key} processQuestionResults={processQuestionResults} />}
            {format === 6 && <WordScrambleExplanation content={content} processQuestionResults={processQuestionResults} />}
            {format === 7 && <SRExplanation content={content} answer_key={answer_key} processQuestionResults={processQuestionResults} />}
            {format === 8 && <WordsSelect content={content} answer_key={answer_key} processQuestionResults={processQuestionResults} />}
            {format === 10 && <DropDown content={content} processQuestionResults={processQuestionResults} />}
            {format === 12 && <SentenceScramble content={content} processQuestionResults={processQuestionResults} />}
            { explanation &&
            <div className="bg-cyan-200 mt-3 p-2">{explanation}</div>
          }
        </Explanation>
        <button 
            className="px-4 py-2 mt-5 rounded-md bg-amber-600 hover:bg-amber-700 text-white font-medium"
            onClick={handleCloseModal}
        >
            Continue
        </button>
    </div>

  )
}

export default IncorrectModal