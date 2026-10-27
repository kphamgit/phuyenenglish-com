import { useEffect, useState } from 'react';
import { useParams, useNavigate, useOutletContext } from 'react-router-dom';
import type { HomeStudentOutletContext } from '../pages/HomeStudent';
import api from '../api';
import ReadingDisplay from './ReadingDisplay';
import TakeQuiz from './TakeQuiz';

// Shows a quiz's reading passage to the student. When they finish reading and hit "Continue",
// they move on to the questions. For now, Continue just shows a popup message.
export default function TakeReadingQuiz() {
  const { category_id, quiz_id } = useParams<{ category_id: string, quiz_id: string }>();
  const navigate = useNavigate();
  // Set when running inside HomeStudent: clicking a vocabulary word adds its card to review.
  const outletContext = useOutletContext<HomeStudentOutletContext | undefined>();
  const [reading, setReading] = useState<string | null>(null);
  const [quizName, setQuizName] = useState('');
  const [loading, setLoading] = useState(true);
  // 'reading' = show the passage; 'questions' = hand off to the normal quiz flow.
  const [phase, setPhase] = useState<'reading' | 'questions'>('reading');

  useEffect(() => {
    if (!quiz_id) return;
    api.get(`/api/quizzes/${quiz_id}/`)
      .then((res) => {
        setReading(res.data.reading ?? null);
        setQuizName(res.data.name ?? '');
      })
      .catch((err) => console.error('Error loading reading:', err))
      .finally(() => setLoading(false));
  }, [quiz_id]);

  const handleContinue = () => {
    // Clear the reading and hand off to the normal quiz flow (first question, etc.).
    setPhase('questions');
  };

  const handleTerminateQuiz = () => {
    if (!window.confirm("End this quiz now?")) return;
    navigate(`/categories/${category_id}`);
  };

  if (loading) return <div className="p-6">Loading…</div>;

  // After Continue: reuse TakeQuiz for the exact question flow, passing the reading so it can
  // offer a "Reread" button next to "Terminate Quiz".
  if (phase === 'questions') {
    return <TakeQuiz readingHtml={reading ?? undefined} />;
  }

  return (
    <div className="relative max-w-3xl mx-auto p-6">
      <button
        onClick={handleTerminateQuiz}
        className="absolute top-2 right-2 z-10 bg-red-600 hover:bg-red-800 text-white text-sm px-3 py-1 rounded-md"
      >
        Terminate Quiz
      </button>
      {quizName && <h2 className="text-2xl font-bold mb-4">{quizName}</h2>}

      {reading && reading.trim()
        ? <ReadingDisplay html={reading} onSenseWordClick={outletContext?.onMarkedWordClick} />
        : <p className="text-gray-600">No reading for this quiz.</p>}

      <div className="mt-6">
        <button
          onClick={handleContinue}
          className="bg-indigo-600 text-white px-5 py-2 rounded-md hover:bg-indigo-800"
        >
          Continue
        </button>
      </div>
    </div>
  );
}
