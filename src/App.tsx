import {
  Gauge,
  Pause,
  Play,
  RotateCcw,
  SkipBack,
  SkipForward,
  SquarePen,
} from "lucide-react";
import { PointerEvent, useEffect, useMemo, useRef, useState } from "react";

type Mode = "edit" | "play";
type HoldSide = "left" | "right" | null;

type ReadingToken = {
  text: string;
  pause: number;
};

const STORAGE_KEY = "read-fast-state-v1";
const MIN_WPM = 80;
const MAX_WPM = 900;
const SPEED_STEP = 20;

const SAMPLE_TEXT =
  "아침의 도시는 아직 완전히 깨어나지 않았지만, 골목마다 작은 소리들이 먼저 움직이기 시작했습니다. 창문을 여는 소리, 커피가 내려지는 소리, 지하철역으로 향하는 발걸음이 느린 리듬을 만들었습니다. 글을 읽는 일도 그와 비슷해서, 너무 서두르지 않을 때 오히려 더 또렷하게 앞으로 나아갑니다.";

const sentenceEndPattern = /[.!?。！？…]+["'”’)\]]*$/;
const clauseEndPattern = /[,，、;:：]+["'”’)\]]*$/;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function tokenizeText(text: string): ReadingToken[] {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  const tokens: ReadingToken[] = [];
  const matcher = /(\S+)(\s*)/g;
  let match: RegExpExecArray | null;

  while ((match = matcher.exec(normalized))) {
    const textValue = match[1];
    const gap = match[2] ?? "";
    let pause = 1;

    if (sentenceEndPattern.test(textValue)) {
      pause = 2.1;
    } else if (clauseEndPattern.test(textValue)) {
      pause = 1.7;
    }

    if (/\n\s*\n/.test(gap)) {
      pause = Math.max(pause, 2.8);
    } else if (/\n/.test(gap)) {
      pause = Math.max(pause, 1.75);
    }

    tokens.push({ text: textValue, pause });
  }

  return tokens;
}

function visualLength(text: string) {
  return Array.from(text.replace(/[^\p{L}\p{N}]/gu, "")).length;
}

function getTokenDelay(token: ReadingToken, wpm: number) {
  const base = 60_000 / wpm;
  const length = visualLength(token.text);
  const lengthPause = length <= 4 ? 1 : 1 + Math.min((length - 4) * 0.08, 0.65);

  return Math.round(base * lengthPause * token.pause);
}

function splitByFocus(text: string) {
  const chars = Array.from(text);
  if (chars.length <= 1) {
    return { before: "", focus: text, after: "" };
  }

  const cleanIndexes = chars
    .map((char, index) => ({ char, index }))
    .filter(({ char }) => /\p{L}|\p{N}/u.test(char));

  if (!cleanIndexes.length) {
    return { before: "", focus: text, after: "" };
  }

  const focusIndex = cleanIndexes[Math.max(0, Math.floor((cleanIndexes.length - 1) / 2))].index;

  return {
    before: chars.slice(0, focusIndex).join(""),
    focus: chars[focusIndex],
    after: chars.slice(focusIndex + 1).join(""),
  };
}

function formatTime(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.max(0, Math.round(totalSeconds % 60));
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function loadInitialState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { text: SAMPLE_TEXT, wpm: 320, index: 0 };
    }

    const parsed = JSON.parse(raw) as Partial<{ text: string; wpm: number; index: number }>;
    return {
      text: parsed.text || SAMPLE_TEXT,
      wpm: clamp(Number(parsed.wpm) || 320, MIN_WPM, MAX_WPM),
      index: Math.max(0, Number(parsed.index) || 0),
    };
  } catch {
    return { text: SAMPLE_TEXT, wpm: 320, index: 0 };
  }
}

function App() {
  const initialState = useMemo(loadInitialState, []);
  const [text, setText] = useState(initialState.text);
  const [wpm, setWpm] = useState(initialState.wpm);
  const [index, setIndex] = useState(initialState.index);
  const [mode, setMode] = useState<Mode>("edit");
  const [isPlaying, setIsPlaying] = useState(false);
  const [holdSide, setHoldSide] = useState<HoldSide>(null);
  const holdTimerRef = useRef<number | null>(null);

  const tokens = useMemo(() => tokenizeText(text), [text]);
  const currentToken = tokens[index] ?? null;
  const progress = tokens.length ? ((index + 1) / tokens.length) * 100 : 0;
  const remainingSeconds = useMemo(() => {
    return tokens.slice(index).reduce((sum, token) => sum + getTokenDelay(token, wpm) / 1000, 0);
  }, [index, tokens, wpm]);

  const focusParts = currentToken ? splitByFocus(currentToken.text) : null;

  useEffect(() => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        text,
        wpm,
        index: clamp(index, 0, Math.max(tokens.length - 1, 0)),
      }),
    );
  }, [index, text, tokens.length, wpm]);

  useEffect(() => {
    setIndex((current) => clamp(current, 0, Math.max(tokens.length - 1, 0)));
  }, [tokens.length]);

  useEffect(() => {
    if (!isPlaying || !currentToken) return;

    const timer = window.setTimeout(() => {
      setIndex((current) => {
        if (current >= tokens.length - 1) {
          setIsPlaying(false);
          return current;
        }

        return current + 1;
      });
    }, getTokenDelay(currentToken, wpm));

    return () => window.clearTimeout(timer);
  }, [currentToken, isPlaying, tokens.length, wpm]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement) {
        return;
      }

      if (event.code === "Space") {
        event.preventDefault();
        if (mode === "play" && tokens.length) {
          setIsPlaying((playing) => !playing);
        }
      }

      if (event.key === "ArrowRight") {
        setWpm((speed) => clamp(speed + SPEED_STEP, MIN_WPM, MAX_WPM));
      }

      if (event.key === "ArrowLeft") {
        setWpm((speed) => clamp(speed - SPEED_STEP, MIN_WPM, MAX_WPM));
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mode, tokens.length]);

  function clearHoldTimer() {
    if (holdTimerRef.current !== null) {
      window.clearInterval(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    setHoldSide(null);
  }

  function adjustSpeed(direction: "down" | "up") {
    setWpm((speed) => clamp(speed + (direction === "up" ? SPEED_STEP : -SPEED_STEP), MIN_WPM, MAX_WPM));
  }

  function startHold(event: PointerEvent<HTMLDivElement>, direction: "down" | "up") {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    clearHoldTimer();
    setHoldSide(direction === "up" ? "right" : "left");
    adjustSpeed(direction);
    holdTimerRef.current = window.setInterval(() => adjustSpeed(direction), 160);
  }

  function enterPlayMode() {
    if (!tokens.length) return;
    setMode("play");
    setIsPlaying(true);
  }

  function returnToEditMode() {
    setIsPlaying(false);
    clearHoldTimer();
    setMode("edit");
  }

  function skip(direction: "back" | "forward") {
    setIndex((current) => clamp(current + (direction === "back" ? -1 : 1), 0, Math.max(tokens.length - 1, 0)));
  }

  function restartReader() {
    clearHoldTimer();
    setIndex(0);
    setIsPlaying(true);
  }

  return (
    <div className={`app app--${mode}`}>
      {mode === "edit" ? (
        <main className="editor-shell">
          <header className="topbar">
            <div className="brand">
              <Gauge size={22} aria-hidden="true" />
              <span>Read Fast</span>
            </div>
            <button className="primary-button" type="button" onClick={enterPlayMode} disabled={!tokens.length}>
              <Play size={18} aria-hidden="true" />
              재생
            </button>
          </header>

          <section className="editor-layout" aria-label="텍스트 편집">
            <div className="text-panel">
              <textarea
                value={text}
                onChange={(event) => {
                  setText(event.target.value);
                  setIndex(0);
                }}
                spellCheck={false}
                aria-label="읽을 텍스트"
              />
            </div>

            <aside className="settings-panel" aria-label="재생 설정">
              <div className="metric-row">
                <span>어절</span>
                <strong>{tokens.length.toLocaleString("ko-KR")}</strong>
              </div>
              <div className="metric-row">
                <span>남은 시간</span>
                <strong>{formatTime(remainingSeconds)}</strong>
              </div>

              <label className="speed-control">
                <span>속도</span>
                <strong>{wpm} WPM</strong>
                <input
                  type="range"
                  min={MIN_WPM}
                  max={MAX_WPM}
                  step={SPEED_STEP}
                  value={wpm}
                  onChange={(event) => setWpm(Number(event.target.value))}
                />
              </label>

            </aside>
          </section>
        </main>
      ) : (
        <main className="reader-shell" aria-label="재생 모드">
          <div className="reader-progress" aria-hidden="true">
            <span style={{ width: `${progress}%` }} />
          </div>

          <button className="edit-button" type="button" onClick={returnToEditMode} aria-label="편집">
            <SquarePen size={20} aria-hidden="true" />
          </button>

          <div
            className={`speed-zone speed-zone--left ${holdSide === "left" ? "is-active" : ""}`}
            onPointerDown={(event) => startHold(event, "down")}
            onPointerUp={clearHoldTimer}
            onPointerCancel={clearHoldTimer}
            onPointerLeave={clearHoldTimer}
            aria-label="속도 낮추기"
          />
          <div
            className={`speed-zone speed-zone--right ${holdSide === "right" ? "is-active" : ""}`}
            onPointerDown={(event) => startHold(event, "up")}
            onPointerUp={clearHoldTimer}
            onPointerCancel={clearHoldTimer}
            onPointerLeave={clearHoldTimer}
            aria-label="속도 높이기"
          />

          <section className="reader-stage">
            <div className="reader-meta">
              <span>
                {tokens.length ? index + 1 : 0} / {tokens.length}
              </span>
              <span>{formatTime(remainingSeconds)}</span>
            </div>

            <div className="word-frame" aria-live="polite" aria-atomic="true">
              {focusParts ? (
                <span className="word">
                  <span className="word-side word-side--before">{focusParts.before}</span>
                  <span className="focus-letter">{focusParts.focus}</span>
                  <span className="word-side word-side--after">{focusParts.after}</span>
                </span>
              ) : (
                <span className="empty-word">텍스트 없음</span>
              )}
            </div>

            <div className={`speed-readout ${holdSide ? "is-pressing" : ""}`}>
              <Gauge size={18} aria-hidden="true" />
              <span>{wpm} WPM</span>
            </div>
          </section>

          <nav className="reader-controls" aria-label="재생 컨트롤">
            <button className="restart-button" type="button" onClick={restartReader}>
              <RotateCcw size={19} aria-hidden="true" />
              <span>처음부터</span>
            </button>
            <button type="button" onClick={() => skip("back")} aria-label="이전">
              <SkipBack size={22} aria-hidden="true" />
            </button>
            <button className="play-toggle" type="button" onClick={() => setIsPlaying((playing) => !playing)}>
              {isPlaying ? <Pause size={28} aria-hidden="true" /> : <Play size={28} aria-hidden="true" />}
              <span>{isPlaying ? "정지" : "재생"}</span>
            </button>
            <button type="button" onClick={() => skip("forward")} aria-label="다음">
              <SkipForward size={22} aria-hidden="true" />
            </button>
          </nav>
        </main>
      )}
    </div>
  );
}

export default App;
