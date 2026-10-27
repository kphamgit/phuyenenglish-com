import { useEffect, useState } from "react";
import { FaPlayCircle } from "react-icons/fa";
import api from "../api";

// --- Shape of the /english/read-dictionary/ response (array of matching entries) ---
interface DictExample {
  id: number;
  sentence: string;
  translation: string;
}
interface DictSense {
  id: number;
  sense_number: number;
  definition: string;
  examples?: DictExample[];
  card_id?: number | null; // id of the card created for this sense, if any (card availability)
}
interface DictPartOfSpeech {
  name: string;
  audio_blob?: string; // blob name (no ".mp3") set when audio exists; "" = none
  senses?: DictSense[];
}
interface DictEntry {
  head_word: string;
  source: string;
  part_of_speeches?: DictPartOfSpeech[];
}

// Ho Ngoc Duc (Viet) dictionary source string on the backend.
const VIET_SOURCE = "ho-ngoc-duc-stardict";

// Look up `word` in the Viet dictionary and show the results in a modal overlay. The teacher can
// check one sense to associate it with the marked word (single-select via `selectedSenseId`).
export default function DictionaryModal({
  word,
  selectedSenseId,
  onSelectSense,
  onClose,
}: {
  word: string;
  selectedSenseId: number | null;
  onSelectSense: (senseId: number | null) => void;
  onClose: () => void;
}) {
  const [entries, setEntries] = useState<DictEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Sense ids a card was just created for this session (for immediate "✓ Card exists" feedback).
  const [createdSenseIds, setCreatedSenseIds] = useState<Set<number>>(new Set());

  // Create the global card for this sense (idempotent on the backend).
  const createCard = (headWord: string, sense: DictSense, partOfSpeech: string) => {
    const body = { text: headWord, definition: sense.definition, part_of_speech: partOfSpeech, sense_id: sense.id };
    console.log("[SendText] 3a. + Create Card -> POST /api/cards/ request:", body);
    api.post("/api/cards/", body)
      .then((res) => {
        console.log("[SendText] 3a. /api/cards/ response:", res.data);
        setCreatedSenseIds((prev) => new Set(prev).add(sense.id));
      })
      .catch((err) => {
        console.error("Error creating card:", err);
        alert("Could not create a card for this sense.");
      });
  };

  useEffect(() => {
    setLoading(true);
    setError(null);
    setEntries(null);
    // DEBUG [SendText]: dictionary lookup for a marked word (remove when done)
    console.log("[SendText] 2a. POST /english/read-dictionary/ request:", { word, source: VIET_SOURCE });
    api.post("/english/read-dictionary/", { word, source: VIET_SOURCE })
      .then((res) => {
        console.log("[SendText] 2a. read-dictionary response (entries -> part_of_speeches -> senses; sense.id is the sense_id):", res.data);
        setEntries(res.data as DictEntry[]);
      })
      .catch((err) => {
        console.error("[SendText] 2a. read-dictionary failed:", err.response?.status, err.response?.data);
        if (err.response?.status === 404) setError(`No dictionary entry found for "${word}".`);
        else setError(err.response?.data?.error ?? "Dictionary lookup failed.");
      })
      .finally(() => setLoading(false));
  }, [word]);

  // Play a part of speech's pronunciation at normal speed, then automatically again slowly.
  const playPos = (audioBlob: string) => {
    const base = "https://kphamazureblobstore.blob.core.windows.net/tts-audio/";
    const normal = new Audio(`${base}${audioBlob}.mp3`);
    normal.onended = () => {
      setTimeout(() => {
        const slow = new Audio(`${base}slow_${audioBlob}.mp3`);
        slow.play().catch(() => {});
      }, 250);
    };
    normal.play().catch(() => {});
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl w-[32rem] max-h-[80vh] overflow-y-auto p-5 text-left"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-3">
          <h2 className="text-xl font-bold text-gray-900">{word}</h2>
          <button onClick={onClose} aria-label="Close" className="text-gray-500 hover:text-gray-800">
            ✕
          </button>
        </div>

        {loading && <p className="text-sm text-gray-500">Looking up…</p>}
        {error && <p className="text-sm text-red-700">{error}</p>}

        {entries?.map((entry, ei) => (
          <div key={ei} className="mb-4 last:mb-0">
            <h3 className="text-lg font-bold text-gray-900">{entry.head_word}</h3>
            {entry.part_of_speeches?.map((pos, pi) => (
              <div key={pi} className="mt-1">
                {pos.name && <span className="italic text-sm text-indigo-700">{pos.name}</span>}
                {pos.audio_blob && (
                  <button
                    onClick={() => playPos(pos.audio_blob!)}
                    title="Play pronunciation"
                    aria-label="Play pronunciation"
                    className="ml-2 align-middle text-green-600 hover:text-green-700"
                  >
                    <FaPlayCircle className="inline text-lg" />
                  </button>
                )}
                <ol className="mt-1 space-y-1">
                  {pos.senses?.map((sense) => (
                    <li key={sense.id} className="text-sm text-gray-800 flex items-start gap-2">
                      {/* Check one sense to associate it with the marked word. */}
                      <input
                        type="checkbox"
                        className="mt-1 shrink-0"
                        checked={selectedSenseId === sense.id}
                        onChange={(e) => onSelectSense(e.target.checked ? sense.id : null)}
                      />
                      <span className="flex-1 min-w-0">
                      {sense.definition}
                      {sense.examples && sense.examples.length > 0 && (
                        <ul className="mt-1 ml-4 space-y-0.5">
                          {sense.examples.map((ex) => (
                            <li key={ex.id} className="text-xs text-gray-500">
                              • {ex.sentence}
                              {ex.translation ? ` — ${ex.translation}` : ""}
                            </li>
                          ))}
                        </ul>
                      )}
                      </span>
                      {/* Card availability for this sense (create one if missing). */}
                      {sense.card_id != null || createdSenseIds.has(sense.id) ? (
                        <span className="mt-0.5 shrink-0 text-xs px-1.5 py-0.5 rounded bg-green-100 text-green-700">
                          ✓ Card exists
                        </span>
                      ) : (
                        <button
                          onClick={() => createCard(entry.head_word, sense, pos.name)}
                          title="Create a review card for this sense"
                          className="mt-0.5 shrink-0 text-xs px-1.5 py-0.5 rounded bg-amber-500 hover:bg-amber-600 text-white"
                        >
                          + Create Card
                        </button>
                      )}
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
