import { useState, useEffect, Fragment } from "react";
import { renderVietPron } from "./vietPron";
import { useSelector } from "react-redux";
import { FaPlayCircle } from "react-icons/fa";
import api from "../api";
import DictionaryEditModal from "./DictionaryEditModal";

// --- Shape of the /english/read-dictionary/ response (array of matching entries) ---
export interface DictExample {
  id: number;
  sentence: string;
  translation: string;
}
export interface DictSense {
  id: number;
  sense_number: number;
  definition: string;
  examples?: DictExample[];
  card_id?: number | null; // id of the teacher-created card for this sense, if any
  in_review?: boolean;     // true if the current student already has this card in their review
}
export interface DictPartOfSpeech {
  id?: number;          // used to attach auto-generated audio to this POS when creating a word
  name: string;
  audio_blob?: string;  // blob name (no ".mp3") set by the backend when audio was generated; "" = none
  viet_pron_code?: string | null; // JSON-array string: the American/flapped form (T -> đ)
  viet_pron_code_standard?: string | null; // JSON-array string: the STANDARD/non-flapped form (keeps t)
  senses?: DictSense[];
}

// The backend stores viet_pron_code as a JSON-array string (e.g. '["kɔn", "con"]').
// Parse it defensively into a string[]; if it isn't valid JSON, fall back to the raw value.
const parseVietProns = (raw: string | null | undefined): string[] => {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.map(String) : [String(arr)];
  } catch {
    return [raw];
  }
};

// renderVietPron (small/brown (h)/(r)/(v) + shrunk tails) now lives in ./vietPron,
// shared with the student's SR prompt display.
export interface DictEntry {
  head_word: string;
  hyphenated?: string; // syllable-hyphenated form of the head word (e.g. "dic-tio-nar-y")
  source: string;
  part_of_speeches?: DictPartOfSpeech[];
}

// Selectable source dictionaries. `label` is what the student sees; `value` is the
// exact `source` string stored on the backend. Viet is the default (first entry).
const SOURCES = [
  { label: "Viet", value: "ho-ngoc-duc-stardict" },
  { label: "Longman", value: "longman" },
];

// mode="student": each reviewable sense gets a "+ Review" button (adds to the student's queue).
// mode="teacher": each sense gets a "+ Create Card" button (creates the global card).
export default function DictionaryLookup({ mode = "student" }: { mode?: "student" | "teacher" }) {
  const { name } = useSelector((state: { user: { name: string; isLoggedIn: boolean } }) => state.user);
  const [word, setWord] = useState("");
  const [source, setSource] = useState(SOURCES[0].value); // default: Viet
  const [entries, setEntries] = useState<DictEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // When a lookup finds nothing, holds the word so we can offer to create it.
  const [notFoundWord, setNotFoundWord] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  // Whether the current user may ADD entries (staff or student_staff). Others are read-only.
  const [canAdd, setCanAdd] = useState(false);
  // Teacher: the entry currently open in the edit modal (null = closed).
  const [editingEntry, setEditingEntry] = useState<DictEntry | null>(null);
  // Teacher: which pronunciation's "Copy" was just clicked (for brief feedback).
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Copy the RAW viet_pron_code (parentheses included, e.g. "t(h)ai-ờm"), wrapped in
  // "/.../" so it drops straight into an SR prompt as a pronunciation guide and renders
  // identically to the dictionary. The on-screen display drops the parens, so a plain
  // text-selection copy would lose them.
  const copyRawPron = (raw: string, key: string) => {
    navigator.clipboard.writeText(`/${raw}/`).then(() => {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1200);
    }).catch((err) => console.error("Copy failed:", err));
  };

  useEffect(() => {
    api.get("/api/me/")
      .then((res) => setCanAdd(!!res.data.is_staff || !!res.data.student_staff))
      .catch(() => setCanAdd(false));
  }, []);
  // sense ids the student has added to their review this session (for button feedback).
  const [addedSenseIds, setAddedSenseIds] = useState<Set<number>>(new Set());
  // sense ids the teacher has created a card for this session (for button feedback).
  const [createdSenseIds, setCreatedSenseIds] = useState<Set<number>>(new Set());

  const search = () => {
    const term = word.trim();
    if (!term) return;
    setLoading(true);
    setError(null);
    setNotFoundWord(null);
    setEntries(null);
    api.post("/english/read-dictionary/", { word: term, source, user_name: name })
      .then((res) => {
        const data = res.data as DictEntry[];
        if (!data || data.length === 0) {
          setNotFoundWord(term); // empty result -> offer to create it
        } else {
          setEntries(data);
        }
      })
      .catch((err) => {
        // 404 => not found: offer to create it. Anything else => generic error.
        if (err.response?.status === 404) {
          setNotFoundWord(term);
        } else {
          setError(err.response?.data?.error ?? "Dictionary lookup failed.");
        }
      })
      .finally(() => setLoading(false));
  };

  // Create a not-found word in the local dictionary, then display it and auto-generate its
  // Azure audio (default voice, normal + slow) for each part of speech.
  const createWord = () => {
    const w = (notFoundWord || "").trim();
    if (!w) return;
    const populateUrl = source === "longman"
      ? "/english/populate-longman-dictionary/"
      : "/english/populate-viet-dictionary/";
    setCreating(true);
    setError(null);
    api.post(populateUrl, { word: w })
      .then(() => api.post("/english/read-dictionary/", { word: w, source, user_name: name }))
      .then((res) => {
        const data = res.data as DictEntry[];
        setEntries(data);
        setNotFoundWord(null);
        // Fire default audio for each POS, then refresh so the Play buttons appear.
        const jobs: Promise<unknown>[] = [];
        data.forEach((entry) =>
          (entry.part_of_speeches || []).forEach((pos) => {
            if (pos.id != null) {
              jobs.push(
                api.post("/api/create-azure-audio/", { pos_id: pos.id, text: entry.head_word, pron: "" }).catch(() => {})
              );
            }
          })
        );
        if (jobs.length) {
          Promise.all(jobs).then(() => {
            api.post("/english/read-dictionary/", { word: w, source, user_name: name })
              .then((r) => setEntries(r.data as DictEntry[]))
              .catch(() => {});
          });
        }
      })
      .catch((err) => {
        // Show the backend's clear message (e.g. "not found") directly when present.
        setError(err.response?.data?.error || `Could not create "${w}".`);
        setNotFoundWord(null);
      })
      .finally(() => setCreating(false));
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") search();
  };

  // Student: add this sense to the review queue. The backend creates the card from the sense
  // if one doesn't exist yet (e.g. a word the student just created), then enrolls the review.
  const addSenseToReview = (senseId: number) => {
    api.post(`/api/cards/from-sense/${senseId}/add-to-review/`)
      .then(() => {
        setAddedSenseIds((prev) => new Set(prev).add(senseId));
      })
      .catch((err) => {
        console.error("Error adding sense to review:", err);
        alert("Could not add this word to your review.");
      });
  };

  // Teacher: create the global card for this sense (idempotent on the backend).
  const createCard = (headWord: string, sense: DictSense, partOfSpeech: string) => {
    api.post("/api/cards/", { text: headWord, definition: sense.definition, part_of_speech: partOfSpeech, sense_id: sense.id })
      .then(() => {
        setCreatedSenseIds((prev) => new Set(prev).add(sense.id));
      })
      .catch((err) => {
        console.error("Error creating card:", err);
        alert("Could not create a card for this sense.");
      });
  };

  const closeResults = () => {
    setEntries(null);
    setError(null);
    setNotFoundWord(null);
  };

  // Teachers get a larger, wider results panel (they scan/curate more than students).
  const isTeacher = mode === "teacher";

  // Play a part of speech's pronunciation at normal speed, then automatically again slowly.
  // The backend stored the normal blob name on the POS (audio_blob) and also generated a natural
  // slow re-synthesis at "slow_<audio_blob>.mp3", so both names are known without any hashing.
  const playPos = (audioBlob: string) => {
    const base = "https://kphamazureblobstore.blob.core.windows.net/tts-audio/";
    const normal = new Audio(`${base}${audioBlob}.mp3`);
    normal.onended = () => {
      // Short pause, then the slow version at true speed (it's already slowed server-side).
      setTimeout(() => {
        const slow = new Audio(`${base}slow_${audioBlob}.mp3`);
        slow.play().catch(() => {});
      }, 250);
    };
    normal.play().catch(() => {});
  };

  return (
    <div className="relative flex items-center gap-2">
      <select
        className="bg-white border border-gray-400 text-black text-sm px-2 py-1 rounded-md"
        value={source}
        onChange={(e) => setSource(e.target.value)}
        title="Source dictionary"
      >
        {SOURCES.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>
      <input
        className="bg-white border border-gray-400 text-black text-sm px-2 py-1 rounded-md w-48"
        placeholder="Look up a word..."
        value={word}
        onChange={(e) => setWord(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <button
        onClick={search}
        disabled={!word.trim() || loading}
        className={`text-white bg-indigo-600 text-sm px-3 py-1 rounded-md hover:bg-indigo-800 ${
          !word.trim() || loading ? "opacity-50 cursor-not-allowed" : ""
        }`}
      >
        {loading ? "..." : "Search"}
      </button>

      {/* Results / error panel */}
      {(entries !== null || error || notFoundWord) && (
        <div className={`absolute top-full right-0 mt-1 ${isTeacher ? "w-[32rem]" : "w-96"} max-h-[70vh] overflow-y-auto bg-white border border-gray-300 rounded-lg shadow-xl z-30 p-4 text-left`}>
          <button
            onClick={closeResults}
            aria-label="Close"
            className="float-right text-gray-500 hover:text-gray-800"
          >
            ✕
          </button>

          {error && <p className="text-red-700 text-sm">{error}</p>}

          {notFoundWord && (
            canAdd ? (
              <div className="text-sm text-gray-700">
                <p>No dictionary entry found for <span className="font-semibold">"{notFoundWord}"</span>. Create it?</p>
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={createWord}
                    disabled={creating}
                    className="bg-indigo-600 text-white text-sm px-3 py-1 rounded-md hover:bg-indigo-800 disabled:opacity-50"
                  >
                    {creating ? "Creating…" : "Yes, create"}
                  </button>
                  <button
                    onClick={() => setNotFoundWord(null)}
                    disabled={creating}
                    className="bg-gray-200 text-gray-800 text-sm px-3 py-1 rounded-md hover:bg-gray-300 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              // Read-only users: no create option, just report that nothing was found.
              <p className="text-sm text-gray-700">No dictionary entry found for <span className="font-semibold">"{notFoundWord}"</span>.</p>
            )
          )}

          {entries && entries.length === 0 && (
            <p className="text-gray-600 text-sm">No results.</p>
          )}

          {entries?.map((entry, ei) => (
            <div key={ei} className="mb-4 last:mb-0">
              <div className="flex flex-row items-center gap-2">
                <h3 className={`font-bold text-gray-900 ${isTeacher ? "text-2xl" : "text-lg"}`}>{entry.head_word}</h3>
                {isTeacher && (
                  <button
                    onClick={() => setEditingEntry(entry)}
                    title="Edit senses and examples"
                    className="text-sm px-3 py-1 rounded bg-green-600 hover:bg-green-700 text-white"
                  >
                    Edit
                  </button>
                )}
              </div>
              {/* Syllable-hyphenated form of the head word. */}
              {entry.hyphenated && (
                <div className={`text-gray-500 ${isTeacher ? "text-base" : "text-sm"}`}>{entry.hyphenated}</div>
              )}
              {entry.part_of_speeches?.map((pos, pi) => (
                <div key={pi} className="mt-1">
                  {pos.name && (
                    <span className={`italic text-indigo-700 ${isTeacher ? "text-base" : "text-sm"}`}>{pos.name}</span>
                  )}
                  {/* Play this part of speech's pronunciation (teacher and student), if audio exists. */}
                  {pos.audio_blob && (
                    <button
                      onClick={() => playPos(pos.audio_blob!)}
                      title="Play pronunciation"
                      aria-label="Play pronunciation"
                      className="ml-2 align-middle bg-blue-600 hover:bg-blue-700 text-white rounded-full p-0.5 leading-none"
                    >
                      <FaPlayCircle className="inline text-lg" />
                    </button>
                  )}
                  {/* Vietnamese pronunciation: STANDARD (non-flapped) first, AMERICAN (flapped,
                      T->đ) only when it differs. Staff users (is_staff or student_staff) get a
                      Copy button next to each form that copies the RAW code (parens intact,
                      wrapped in /.../) for pasting into an SR prompt. */}
                  {(() => {
                    const standard = parseVietProns(pos.viet_pron_code_standard);
                    const american = parseVietProns(pos.viet_pron_code);
                    const primaryIsStandard = standard.length > 0;
                    const primary = primaryIsStandard ? standard : american; // fallback if not backfilled
                    if (primary.length === 0) return null;
                    const differs = standard.length > 0 && american.length > 0
                      && JSON.stringify(standard) !== JSON.stringify(american);
                    const label = (t: string) => (
                      <span className="text-[0.6em] uppercase tracking-wide text-gray-500 align-middle">{t}</span>
                    );
                    const pron = (list: string[]) => (
                      <span className={`text-[#5a3825] font-serif ${isTeacher ? "text-lg" : "text-base"}`}>
                        {"/"}
                        {list.map((p, i) => (<Fragment key={i}>{i > 0 && ", "}{renderVietPron(p)}</Fragment>))}
                        {"/"}
                      </span>
                    );
                    const form = (list: string[], tag: string, key: string, showLabel: boolean) => (
                      <span className="inline-flex items-center gap-x-1">
                        {showLabel && label(tag)}
                        {pron(list)}
                        {canAdd && list.length > 0 && (
                          <button
                            onClick={() => copyRawPron(list.join(", "), key)}
                            title={`Copy the raw ${tag} pronunciation (with parentheses) for an SR prompt`}
                            className="text-[0.7em] px-1.5 py-0.5 rounded bg-gray-600 hover:bg-gray-800 text-white align-middle"
                          >
                            {copiedKey === key ? "Copied!" : "Copy"}
                          </button>
                        )}
                      </span>
                    );
                    return (
                      <span className="ml-2 inline-flex flex-wrap items-center gap-x-3 gap-y-1">
                        {form(primary, primaryIsStandard ? "Standard" : "American",
                              primaryIsStandard ? `${ei}-${pi}-std` : `${ei}-${pi}-am`, differs)}
                        {differs && form(american, "American", `${ei}-${pi}-am`, true)}
                      </span>
                    );
                  })()}
                  <ol className="list-decimal list-inside mt-1 space-y-1">
                    {pos.senses?.map((sense) => (
                      <li key={sense.id} className={`text-gray-800 ${isTeacher ? "text-base" : "text-sm"}`}>
                        <span>{sense.definition}</span>
                        {mode === "teacher" ? (
                          // Teacher: create a card for any sense that doesn't already have one.
                          sense.card_id != null || createdSenseIds.has(sense.id) ? (
                            <span className="ml-2 align-baseline text-xs px-1.5 py-0.5 rounded bg-green-100 text-green-700">
                              ✓ Card exists
                            </span>
                          ) : (
                            <button
                              onClick={() => createCard(entry.head_word, sense, pos.name)}
                              title="Create a review card for this sense"
                              className="ml-2 align-baseline text-xs px-1.5 py-0.5 rounded bg-amber-600 hover:bg-amber-700 text-white"
                            >
                              + Create Card
                            </button>
                          )
                        ) : (
                          // Student: every sense is reviewable. If no card exists yet (e.g. a word
                          // the student just created), the backend creates it on the first click.
                          // Already in review (prior session) or added this session -> show a badge.
                          sense.in_review || addedSenseIds.has(sense.id) ? (
                            <span className="ml-2 align-baseline text-xs px-1.5 py-0.5 rounded bg-green-100 text-green-700">
                              ✓ In review
                            </span>
                          ) : (
                            <button
                              onClick={() => addSenseToReview(sense.id)}
                              title="Add this sense to my review"
                              className="ml-2 align-baseline text-xs px-1.5 py-0.5 rounded bg-amber-600 hover:bg-amber-700 text-white"
                            >
                              {sense.card_id != null ? "+ Review" : "Create Card and add Review"}
                            </button>
                          )
                        )}
                        {sense.examples && sense.examples.length > 0 && (
                          <ul className="mt-1 ml-4 space-y-0.5">
                            {sense.examples.map((ex) => (
                              <li key={ex.id} className={`text-gray-500 ${isTeacher ? "text-sm" : "text-xs"}`}>
                                • {ex.sentence}
                                {ex.translation ? ` — ${ex.translation}` : ""}
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {editingEntry && (
        <DictionaryEditModal
          entry={editingEntry}
          onClose={(changed) => {
            setEditingEntry(null);
            if (changed) search(); // refresh the results so saved edits show in the panel
          }}
        />
      )}
    </div>
  );
}
