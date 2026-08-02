import { useEffect, useState, useRef, useCallback } from "react";
import { synth } from "./utils/audio";
import { SkillOrbit } from "./components/SkillOrbit";
import { ChatContainer, Message } from "./components/ChatContainer";
import { ChatSidebar, ChatSession } from "./components/ChatSidebar";

const API_BASE = "http://localhost:8000";

export default function App() {
  // ── Chat State ───────────────────────────────────────────────────────────
  const [messages, setMessages]         = useState<Message[]>([]);
  const [chatInput, setChatInput]       = useState("");
  const [isTyping, setIsTyping]         = useState(false);
  const [soundEnabled]                  = useState(true);
  const [isChatExpanded, setIsChatExpanded] = useState(false);

  // ── Session / Sidebar State ───────────────────────────────────────────────
  const [sessions, setSessions]             = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsLoadingMore, setSessionsLoadingMore] = useState(false);
  const [totalSessions, setTotalSessions]     = useState(0);
  const [sidebarOpen, setSidebarOpen]       = useState(false);

  const sessionIdRef  = useRef<string>("");
  const isTypingRef   = useRef(false);

  useEffect(() => { isTypingRef.current = isTyping; }, [isTyping]);

  // ── Load sessions with pagination support ─────────────────────────────────
  const fetchSessions = useCallback(async (reset = false) => {
    if (reset) {
      setSessionsLoading(true);
    } else {
      setSessionsLoadingMore(true);
    }
    try {
      let skipCount = 0;
      if (!reset) {
        setSessions((prev) => {
          skipCount = prev.length;
          return prev;
        });
      }
      const res = await fetch(`${API_BASE}/chats?limit=10&skip=${skipCount}`);
      if (res.ok) {
        const data = await res.json();
        const fetched = data.sessions || [];
        setSessions((prev) => {
          if (reset) return fetched;
          // Avoid duplicates
          const existingIds = new Set(prev.map((s) => s._id));
          const newSessions = fetched.filter((s: ChatSession) => !existingIds.has(s._id));
          return [...prev, ...newSessions];
        });
        setTotalSessions(data.total || 0);
      }
    } catch { /* backend offline */ }
    finally {
      setSessionsLoading(false);
      setSessionsLoadingMore(false);
    }
  }, []);

  useEffect(() => { fetchSessions(true); }, [fetchSessions]);

  // ── Load messages for a session ───────────────────────────────────────────
  const loadSession = useCallback(async (sessionId: string) => {
    setActiveSessionId(sessionId);
    sessionIdRef.current = sessionId;
    setMessages([]);
    try {
      const res = await fetch(`${API_BASE}/chats/${sessionId}/messages`);
      if (res.ok) {
        const data = await res.json();
        const loaded: Message[] = (data.messages || []).map((m: { role: string; text: string }) => ({
          sender: m.role === "user" ? "user" : "ai",
          text: m.text,
          isStreaming: false,
        }));
        setMessages(loaded);
      }
    } catch { /* ignore */ }
  }, []);

  // ── Create new chat ───────────────────────────────────────────────────────
  const createNewChat = useCallback(async () => {
    if (soundEnabled) synth.play("click");
    try {
      const res = await fetch(`${API_BASE}/chats`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "New Chat" }),
      });
      if (res.ok) {
        const session: ChatSession = await res.json();
        setSessions((prev) => [session, ...prev]);
        setActiveSessionId(session._id);
        sessionIdRef.current = session._id;
        setMessages([]);
        setTimeout(() => {
          streamAiMessage("New chat started! 👋 Ask me anything about Yug.");
        }, 150);
      }
    } catch {
      // Fallback: just clear messages
      sessionIdRef.current = "";
      setActiveSessionId(null);
      setMessages([]);
    }
    setSidebarOpen(false);
  }, [soundEnabled]);

  // ── Delete a chat session ─────────────────────────────────────────────────
  const deleteSession = useCallback(async (sessionId: string) => {
    if (soundEnabled) synth.play("click");
    try {
      await fetch(`${API_BASE}/chats/${sessionId}`, { method: "DELETE" });
    } catch { /* ignore */ }
    setSessions((prev) => prev.filter((s) => s._id !== sessionId));
    if (activeSessionId === sessionId) {
      setActiveSessionId(null);
      sessionIdRef.current = "";
      setMessages([]);
      setTimeout(() => {
        streamAiMessage("Hi 👋 I'm Yug's AI. Select a chat or start a new one.");
      }, 100);
    }
  }, [activeSessionId, soundEnabled]);

  // ── SSE Streaming ─────────────────────────────────────────────────────────
  // ── SSE Emulated Greeting Stream ─────────────────────────────────────────
  const streamAiMessage = useCallback((fullText: string, callback?: () => void) => {
    setIsTyping(true);
    let index = 0;
    setMessages((prev) => [...prev, { sender: "ai", text: "", isStreaming: true }]);
    
    // Chunking text update for emulated greeting with throttle
    const interval = setInterval(() => {
      setMessages((prev) => {
        if (prev.length === 0) return prev;
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.isStreaming) {
          next[next.length - 1] = {
            ...last,
            text: fullText.slice(0, index + 3)
          };
        }
        return next;
      });
      index += 3;
      if (index >= fullText.length) {
        clearInterval(interval);
        setMessages((prev) => {
          if (prev.length === 0) return prev;
          const next = [...prev];
          const last = next[next.length - 1];
          if (last) {
            next[next.length - 1] = {
              ...last,
              text: fullText,
              isStreaming: false
            };
          }
          return next;
        });
        setIsTyping(false);
        if (callback) callback();
      }
    }, 16);
  }, []);

  // ── Send a query ──────────────────────────────────────────────────────────
  const handleQuery = useCallback(async (query: string) => {
    if (isTypingRef.current) return;
    if (soundEnabled) synth.play("click");

    // If no active session, create one first
    let sid = sessionIdRef.current;
    if (!sid) {
      try {
        const res = await fetch(`${API_BASE}/chats`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: "New Chat" }),
        });
        if (res.ok) {
          const session: ChatSession = await res.json();
          sid = session._id;
          sessionIdRef.current = sid;
          setActiveSessionId(sid);
          setSessions((prev) => [session, ...prev]);
        }
      } catch { /* continue without persisting */ }
    }

    setMessages((prev) => [
      ...prev,
      { sender: "user", text: query },
      { sender: "ai", text: "", isStreaming: true },
    ]);
    setIsTyping(true);

    const accRef = { text: "" };

    const finalizeStream = () => {
      setMessages((prev) => {
        if (prev.length === 0) return prev;
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.isStreaming) {
          next[next.length - 1] = {
            ...last,
            text: accRef.text,
            isStreaming: false
          };
        }
        return next;
      });
      setIsTyping(false);
      // Refresh session list to update titles + ordering
      fetchSessions(true);
    };

    const appendToken = (token: string) => {
      accRef.text += token;
      setMessages((prev) => {
        if (prev.length === 0) return prev;
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.isStreaming) {
          next[next.length - 1] = {
            ...last,
            text: accRef.text
          };
        }
        return next;
      });
    };

    try {
      const response = await fetch(`${API_BASE}/query/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, session_id: sid }),
      });

      if (!response.ok || !response.body) throw new Error(`Backend error: ${response.status}`);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let rawBuffer = "";

      outer: while (true) {
        const { done, value } = await reader.read();
        if (done) { finalizeStream(); break; }

        rawBuffer += decoder.decode(value, { stream: true });
        const events = rawBuffer.split("\n\n");
        rawBuffer = events.pop() ?? "";

        for (const event of events) {
          const lines = event.split("\n");
          let eventType = "";
          let dataPayload = "";

          for (const line of lines) {
            if (line.startsWith("event: ")) eventType = line.slice(7).trim();
            else if (line.startsWith("data: ")) dataPayload = line.slice(6);
          }

          if (eventType === "session") {
            const newId = dataPayload.trim();
            if (newId && newId !== sessionIdRef.current) {
              sessionIdRef.current = newId;
              setActiveSessionId(newId);
            }
            continue;
          }
          if (eventType === "error") {
            accRef.text = `⚠️ Server error: ${dataPayload}`;
            finalizeStream();
            break outer;
          }
          if (dataPayload === "[DONE]") { finalizeStream(); break outer; }
          if (dataPayload) appendToken(dataPayload.replace(/\\n/g, "\n"));
        }
      }
    } catch (err) {
      console.error("RAG Backend connection failed:", err);
      accRef.text = "⚠️ **Connection Error**: RAG server offline. Please start your FastAPI backend.";
      finalizeStream();
    }
  }, [fetchSessions, loadSession, streamAiMessage]);

  const handleSelectSession = useCallback((id: string) => {
    loadSession(id);
    setSidebarOpen(false);
  }, [loadSession]);

  const handleCloseSidebar = useCallback(() => {
    setSidebarOpen(false);
  }, []);

  const handleOpenSidebar = useCallback(() => {
    setSidebarOpen(true);
  }, []);

  const handleToggleSidebar = useCallback(() => {
    setSidebarOpen((prev) => !prev);
  }, []);

  const handleLoadMoreSessions = useCallback(() => {
    fetchSessions(false);
  }, [fetchSessions]);

  // ── Mouse trail canvas ────────────────────────────────────────────────────
  const initTrailCanvas = () => {
    const canvas = document.getElementById("trailCanvas") as HTMLCanvasElement;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);
    const handleResize = () => { width = canvas.width = window.innerWidth; height = canvas.height = window.innerHeight; };
    window.addEventListener("resize", handleResize);
    const points: { x: number; y: number }[] = [];
    const maxPoints = 20;
    const handleMouseMove = (e: MouseEvent) => {
      points.push({ x: e.clientX, y: e.clientY });
      if (points.length > maxPoints) points.shift();
    };
    window.addEventListener("mousemove", handleMouseMove);
    let animationId: number;
    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      if (points.length > 1) {
        const gradient = ctx.createLinearGradient(0, 0, width, height);
        gradient.addColorStop(0, "rgba(124,58,237,0.15)");
        gradient.addColorStop(0.5, "rgba(37,99,235,0.15)");
        gradient.addColorStop(1, "rgba(219,39,119,0.15)");
        ctx.strokeStyle = gradient;
        ctx.lineWidth = 5;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) {
          const xc = (points[i].x + points[i - 1].x) / 2;
          const yc = (points[i].y + points[i - 1].y) / 2;
          ctx.quadraticCurveTo(points[i - 1].x, points[i - 1].y, xc, yc);
        }
        ctx.stroke();
      }
      animationId = requestAnimationFrame(draw);
    };
    draw();
    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("mousemove", handleMouseMove);
      cancelAnimationFrame(animationId);
    };
  };

  // Initial greeting (only if no session loaded)
  useEffect(() => {
    const cleanup = initTrailCanvas();
    const timeout = setTimeout(() => {
      if (messages.length === 0) {
        streamAiMessage("Hi 👋 I'm Yug's AI. Ask me anything about Yug, or open chat history on the left.");
      }
    }, 400);
    return () => {
      if (cleanup) cleanup();
      clearTimeout(timeout);
    };
  }, []);

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-[#fafafb] text-[#09090b] flex flex-col font-sans select-none antialiased bg-[url('/futuristic_lab_bg.png')] bg-cover bg-center">

      {/* Sidebar */}
      <ChatSidebar
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelectSession={handleSelectSession}
        onNewChat={createNewChat}
        onDeleteSession={deleteSession}
        isLoading={sessionsLoading}
        isOpen={sidebarOpen}
        onClose={handleCloseSidebar}
        hasMore={sessions.length < totalSessions}
        onLoadMore={handleLoadMoreSessions}
        isLoadingMore={sessionsLoadingMore}
      />

      {/* Light overlay */}
      <div className="absolute inset-0 bg-white/45 backdrop-blur-[1px] z-0 pointer-events-none" />

      {/* Mouse trail canvas */}
      <canvas id="trailCanvas" className="fixed inset-0 pointer-events-none z-50" />

      {/* Top neon ceiling */}
      <div className="absolute top-[8%] left-[10%] right-[10%] h-[12px] bg-white rounded-full opacity-60 shadow-[0_0_35px_rgba(255,255,255,1),_0_0_20px_rgba(124,58,237,0.3)] filter blur-[1px] pointer-events-none z-10" />

      {/* Glass partitions */}
      <div className="absolute inset-y-0 left-[20%] w-[1px] bg-white/20 pointer-events-none z-10" />
      <div className="absolute inset-y-0 right-[25%] w-[1px] bg-white/20 pointer-events-none z-10" />

      {/* Auroral glow */}
      <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
        <div className="absolute top-[-10%] left-[5%] w-[55%] h-[55%] rounded-full bg-purple-500/5 blur-[140px]" />
        <div className="absolute bottom-[5%] right-[10%] w-[45%] h-[45%] rounded-full bg-teal-500/5 blur-[140px]" />
      </div>

      {/* ── HEADER ────────────────────────────────── */}
      <header className="z-10 px-6 py-5 flex justify-between items-center bg-transparent">
        <div className="flex items-center gap-3">
          {/* Sidebar toggle */}
          <button
            type="button"
            onClick={handleOpenSidebar}
            className="w-9 h-9 rounded-xl flex items-center justify-center border border-zinc-200 bg-white/70 shadow-sm hover:bg-zinc-950 hover:text-white hover:border-zinc-950 transition-all cursor-pointer group"
            title="Chat History"
          >
            <svg className="w-4 h-4 text-zinc-600 group-hover:text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <div className="w-8 h-8 bg-zinc-950 rounded-lg flex items-center justify-center font-bold text-white text-sm">Y</div>
          <span className="font-bold text-sm tracking-tight text-zinc-950">yug.ai</span>
        </div>

        <div className="flex items-center gap-3">
          {/* New Chat shortcut */}
          <button
            type="button"
            onClick={createNewChat}
            className="text-xs font-bold text-zinc-500 hover:text-purple-600 transition-colors px-3 py-1.5 rounded-full border border-zinc-200 bg-white/60 shadow-sm cursor-pointer flex items-center gap-1.5"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            New Chat
          </button>
          {/* Download Resume Button */}
          <a
            href="/yug_resume.pdf"
            download="Yug_Agarwal_Resume.pdf"
            className="text-xs font-bold text-white bg-purple-600 hover:bg-purple-700 hover:shadow-[0_0_15px_rgba(124,58,237,0.4)] transition-all px-3 py-1.5 rounded-full shadow-sm flex items-center gap-1.5 cursor-pointer"
            title="Download Yug's Resume"
          >
            <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            Resume
          </a>
        </div>
      </header>

      {/* ── MAIN GRID ─────────────────────────────── */}
      <main className="relative z-10 flex-1 w-full max-w-none px-6 lg:px-12 flex flex-col lg:grid lg:grid-cols-12 gap-8 items-center py-6 overflow-y-auto lg:overflow-hidden">

        {/* LEFT: Branding */}
        <div className="lg:col-span-3 flex flex-col gap-6 text-left">
          <div className="flex flex-col gap-4">
            <h1 className="text-5xl sm:text-6xl lg:text-[72px] font-extrabold tracking-tighter text-[#09090b] leading-[0.98]">
              Building <span className="rainbow-text">AI</span><br />
              that people<br />
              remember.
            </h1>
            <p className="text-zinc-600 text-lg leading-relaxed font-semibold mt-4 max-w-sm">
              I build intelligent products, AI agents, backend systems and scalable software that solve real-world problems.
            </p>
          </div>
          <div className="flex items-center gap-3 mt-6">
            <button
              type="button"
              onClick={() => handleQuery("Projects")}
              className="px-7 py-3.5 rounded-full bg-zinc-950 text-white font-bold text-sm hover:bg-purple-600 hover:shadow-[0_0_25px_rgba(124,58,237,0.3)] transition-all flex items-center gap-2 cursor-pointer"
            >
              <span>→ Talk with My AI</span>
            </button>
            <button
              type="button"
              onClick={() => handleQuery("Projects")}
              className="px-7 py-3.5 rounded-full border border-zinc-200 bg-white text-zinc-600 font-bold text-sm hover:bg-zinc-50 transition-all cursor-pointer"
            >
              → View Projects
            </button>
          </div>
        </div>

        {/* CENTER: Avatar */}
        <div className="lg:col-span-4 flex justify-center items-center relative h-[380px] lg:h-[620px]">
          <div className="absolute w-[430px] h-[430px] rounded-full energy-ring opacity-20 blur-xl animate-pulse" />
          <div className="absolute w-[450px] h-[450px] rounded-full border-2 border-purple-500/20 shadow-[0_0_25px_rgba(124,58,237,0.25),inset_0_0_20px_rgba(124,58,237,0.15)] pointer-events-none z-10" />
          <div className="absolute w-[450px] h-[450px] rounded-full border-2 border-dashed border-cyan-500/15 animate-spin pointer-events-none z-10" style={{ animationDuration: "60s" }} />
          <SkillOrbit onSkillClick={handleQuery} />
          <div className="absolute bottom-6 w-[400px] h-32 rounded-2xl glass-panel border border-white/60 shadow-inner z-0 pointer-events-none transform -skew-x-12 opacity-50" />
          <div className="w-[360px] h-[520px] rounded-3xl overflow-hidden flex items-end justify-center relative z-30 select-none">
            <img
              src="/yug_real_avatar.png"
              alt="Yug's Standing Agent"
              width={360}
              height={520}
              className="w-full h-full object-contain select-none pointer-events-none"
            />
          </div>
        </div>

        {/* Layout placeholder when expanded */}
        {isChatExpanded && <div className="hidden lg:block lg:col-span-5 h-[640px] pointer-events-none" />}

        {/* RIGHT: Chat */}
        <ChatContainer
          messages={messages}
          isTyping={isTyping}
          chatInput={chatInput}
          setChatInput={setChatInput}
          handleQuery={handleQuery}
          isChatExpanded={isChatExpanded}
          setIsChatExpanded={setIsChatExpanded}
          onNewChat={createNewChat}
          onToggleSidebar={handleToggleSidebar}
        />
      </main>

      {/* ── FOOTER ────────────────────────────────── */}
      <footer className="relative z-10 py-5 border-t border-white/5 text-center select-none bg-transparent">
        <span className="text-base text-zinc-500 font-medium tracking-wide">
          &copy; 2026 yug.ai &mdash; All connections operational.
        </span>
      </footer>
    </div>
  );
}
