import "../styles/Note.css"
//import type { CategoryProps } from "./Category";
import { useNavigate, useParams } from 'react-router-dom';
import api from "../api";
import { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import type { RootState } from "../redux/store";
import ReadingDisplay from "./ReadingDisplay";

interface UnitProps {
    id: number,
    name: string,
    unit_number: number,
    quizzes?: QuizProps[]
}

interface QuizProps {
    id: number,
    name: string,
    quiz_number: number,
    video_url?: string,
    reading?: string | null,
    description?: string | null,
    video_segments? : any[]
}

interface QuestionRow {
    id: number,
    question_number: number,
    format: number,
    prompt?: string,
    content: string,
    answer_key: string,
}

// Human-readable names for the numeric question `format` (derived from the displayQuestion switch).
const FORMAT_LABELS: Record<number, string> = {
    1: "Cloze (word inputs)",
    2: "Cloze (button select)",
    3: "Button Select",
    4: "Radio (single choice)",
    5: "Checkbox (multi choice)",
    6: "Drag & Drop",
    7: "Speech Recognition",
    8: "Words Select",
    10: "Dropdowns",
    12: "Sentence Scramble",
};


function Category() {
    const params = useParams<{ category_id: string }>();
    const [units, setUnits] = useState<UnitProps[]>([]);
    const [id, setId] = useState<number>(0);

    const navigate = useNavigate();

    // The app identifies the teacher by the user name "teacher" (same convention as ScoreBoard/Home).
    const { name } = useSelector((state: RootState) => state.user);
    const isTeacher = name === "teacher";

    // Teacher-only: questions of the quiz being inspected (null => modal closed).
    const [quizQuestions, setQuizQuestions] = useState<QuestionRow[] | null>(null);
    const [inspectedQuiz, setInspectedQuiz] = useState<QuizProps | null>(null);

    // student_staff users get a "?" button next to each quiz that shows its description.
    const [isStudentStaff, setIsStudentStaff] = useState(false);
    const [descriptionQuiz, setDescriptionQuiz] = useState<QuizProps | null>(null);

    useEffect(() => {
        api.get("/api/me/")
            .then((res) => setIsStudentStaff(!!res.data.student_staff))
            .catch(() => setIsStudentStaff(false));
    }, []);

    useEffect(() => {
       if (params.category_id) {
           setId(parseInt(params.category_id));
       }
    }, [params.category_id]);

    useEffect(() => {
        if (id !== 0) {
            //console.log("Fetching units for category id:", id);
            getUnits();
        }
    }, [id]);

    const getUnits = () => {
        //alert("Getting units for category id:");
        
        api
            .get(`/api/categories/${id}/units/`)
            .then((res) => res.data)
            .then((data) => {
                setUnits(data);
               
            })
            .catch((err) => alert(err));
            
    };

    const take_quiz = (quiz: QuizProps) => {
        if (isTeacher) {
            // Teacher clicked the quiz — fetch all its questions and show them in a table.
            setInspectedQuiz(quiz);
            api
                .get<QuestionRow[]>(`/english/quizzes/${quiz.id}/questions`)
                .then((res) => setQuizQuestions(res.data))
                .catch((err) => {
                    console.error("Error fetching questions for quiz", quiz.id, err);
                    alert("Failed to load questions for this quiz.");
                    setInspectedQuiz(null);
                });
            return;
        }
        // Student takes the quiz.
        const api_url = `/categories/${id}/take_quiz/${quiz.id}`
        console.log("Take quiz, navigating to:", api_url);
        navigate(api_url)
    }

    const closeQuestionsModal = () => {
        setQuizQuestions(null);
        setInspectedQuiz(null);
    };

    const take_video_quiz = (quiz: QuizProps) => {
        console.log("Taking video quiz:", quiz);
        const api_url = `/categories/${id}/take_video_quiz/${quiz.id}`
        navigate(api_url, {state: {quiz_id: quiz.id, video_url : quiz.video_url, video_segments: quiz.video_segments}})
    }

    // Student reads the quiz's reading passage first, then continues to the questions.
    const take_reading_quiz = (quiz: QuizProps) => {
        navigate(`/categories/${id}/take_reading_quiz/${quiz.id}`)
    }

    // True when the reading field has real content (ignores an empty <p></p> / whitespace,
    // but counts a reading that only has an image).
    const hasReading = (html?: string | null) => {
        if (!html) return false;
        if (/<img/i.test(html)) return true;
        return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, '').trim().length > 0;
    }

    // Clicking a quiz name opens the right experience for its type:
    // video quiz -> video; else a quiz with a reading -> reading; else the normal quiz.
    const open_quiz = (quiz: QuizProps) => {
        if (quiz.video_url) {
            take_video_quiz(quiz);
        } else if (hasReading(quiz.reading)) {
            take_reading_quiz(quiz);
        } else {
            take_quiz(quiz);
        }
    }

    return (
        <div className="flex flex-col bg-amber-100 p-10">
            {
                units.map((unit) => (
                    <div key={unit.id}>
                        <p className="px-3 my-1 text-blue-500 text-lg">Unit {unit.unit_number}. <span>{unit.name}</span></p>
                        
                        {
                            unit.quizzes && unit.quizzes.map((quiz) => (
                                <div key={quiz.id} className="px-6 my-1">
                                    <span>{quiz.quiz_number}.</span>

                                    <button className=' px-2 rounded-md hover:underline' onClick={() => open_quiz(quiz)}>
                                        {quiz.name}
                                    </button>
                                    { isTeacher &&
                                        <span className="ml-2 text-base font-bold text-red-800">(id: {quiz.id})</span>
                                    }
                                    { isStudentStaff &&
                                        <button
                                            className="ml-1 px-1.5 rounded bg-green-200 text-blue-700 hover:bg-green-300"
                                            title="Show quiz description"
                                            onClick={() => setDescriptionQuiz(quiz)}
                                        >
                                            ?
                                        </button>
                                    }
                                </div>
                            ))
                        }
                    </div>
                ))
            }

            {/* student_staff: quiz description */}
            {descriptionQuiz && (
                <div
                    className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
                    onClick={() => setDescriptionQuiz(null)}
                >
                    <div
                        className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between p-4 border-b">
                            <h2 className="text-lg font-bold text-gray-800">{descriptionQuiz.name}</h2>
                            <button
                                className="px-3 py-1 rounded-md bg-gray-200 hover:bg-gray-300 text-gray-700"
                                onClick={() => setDescriptionQuiz(null)}
                            >
                                Close
                            </button>
                        </div>
                        <div className="overflow-auto p-4 whitespace-pre-wrap text-gray-800">
                            {descriptionQuiz.description?.trim()
                                ? <ReadingDisplay html={descriptionQuiz.description} />
                                : <span className="text-gray-500 italic">This quiz has no description.</span>}
                        </div>
                    </div>
                </div>
            )}

            {/* Teacher-only: questions table for the inspected quiz */}
            {quizQuestions && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-lg shadow-xl w-full max-w-5xl max-h-[85vh] flex flex-col">
                        <div className="flex items-center justify-between p-4 border-b">
                            <h2 className="text-lg font-bold text-gray-800">
                                Questions — {inspectedQuiz?.name} (id: {inspectedQuiz?.id})
                            </h2>
                            <button
                                className="px-3 py-1 rounded-md bg-gray-200 hover:bg-gray-300 text-gray-700"
                                onClick={closeQuestionsModal}
                            >
                                Close
                            </button>
                        </div>
                        <div className="overflow-auto p-4">
                            {quizQuestions.length === 0 ? (
                                <p className="text-gray-600">This quiz has no questions.</p>
                            ) : (
                                <table className="w-full border-collapse text-sm">
                                    <thead>
                                        <tr className="bg-gray-100 text-left">
                                            <th className="border p-2">Q#</th>
                                            <th className="border p-2">Format</th>
                                            <th className="border p-2">Prompt</th>
                                            <th className="border p-2">Content</th>
                                            <th className="border p-2">Answer Key</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {quizQuestions.map((q) => (
                                            <tr key={q.id} className="align-top">
                                                <td className="border p-2 whitespace-nowrap">{q.question_number}</td>
                                                <td className="border p-2 whitespace-nowrap">{FORMAT_LABELS[q.format] ?? q.format}</td>
                                                <td className="border p-2 whitespace-pre-wrap">{q.prompt}</td>
                                                <td className="border p-2 whitespace-pre-wrap">{q.content}</td>
                                                <td className="border p-2 whitespace-pre-wrap">{q.answer_key}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default Category