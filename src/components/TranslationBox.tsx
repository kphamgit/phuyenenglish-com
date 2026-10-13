import { useState } from "react";
import api from "../api";

// A small translator: auto-detects the input language and translates Vietnamese ↔ English
// (Vietnamese in -> English out, otherwise -> Vietnamese out), via the /api/translate/ endpoint.
export default function TranslationBox() {
  const [text, setText] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const translate = () => {
    const t = text.trim();
    if (!t) return;
    setLoading(true);
    setResult(null);
    api.post<{ translation: string }>("/api/translate/", { text: t })
      .then((res) => setResult(res.data.translation || "(no translation)"))
      .catch((err) => {
        console.error("Translation error:", err);
        alert("Translation failed. Please try again.");
      })
      .finally(() => setLoading(false));
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") translate();
  };

  return (
    <div className="relative w-[720px] p-3 bg-white rounded-md border border-gray-300 shadow-lg">
      {/* Result pops up above the input so it isn't clipped by the screen bottom. */}
      {result !== null && (
        <div className="absolute bottom-full mb-2 left-0 right-0 p-2 bg-gray-50 border border-gray-200 rounded-md whitespace-pre-wrap text-gray-800 shadow-md">
          {result}
        </div>
      )}
      {/* Input and Translate button on one line to keep the box short. */}
      <div className="flex items-center gap-2">
        <input
          className="flex-1 bg-gray-100 text-black border border-gray-300 rounded-md p-2"
          placeholder="Translate Vietnamese ↔ English…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <button
          onClick={translate}
          disabled={!text.trim() || loading}
          className={`shrink-0 px-4 py-2 rounded-md text-white bg-blue-600 hover:bg-blue-800 ${
            !text.trim() || loading ? "opacity-50 cursor-not-allowed" : ""
          }`}
        >
          {loading ? "Translating…" : "Translate"}
        </button>
      </div>
    </div>
  );
}
