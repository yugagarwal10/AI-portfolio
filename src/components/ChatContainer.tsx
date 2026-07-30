import { useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { synth } from "../utils/audio";

export interface Message {
  sender: "user" | "ai";
  text: string;
  isStreaming?: boolean;
}

interface ChatContainerProps {
  messages: Message[];
  isTyping: boolean;
  chatInput: string;
  setChatInput: (val: string) => void;
  handleQuery: (query: string) => void;
  isChatExpanded: boolean;
  setIsChatExpanded: (val: boolean) => void;
  onNewChat?: () => void;
  onToggleSidebar?: () => void;
}

export const ChatContainer: React.FC<ChatContainerProps> = ({
  messages,
  isTyping,
  chatInput,
  setChatInput,
  handleQuery,
  isChatExpanded,
  setIsChatExpanded,
  onNewChat,
  onToggleSidebar,
}) => {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  return (
    <div className={`
      flex flex-col rounded-[32px] glass-panel overflow-hidden border border-white/60 shadow-[0_25px_60px_-15px_rgba(124,58,237,0.12)] transition-all duration-500 ease-in-out
      ${isChatExpanded 
        ? "fixed inset-6 z-[99] w-[calc(100vw-48px)] h-[calc(100vh-48px)] shadow-[0_30px_100px_rgba(124,58,237,0.25)] scale-100" 
        : "relative lg:col-span-5 w-full h-[640px] scale-100"
      }
    `}>
      
      {/* Top Bar Header (macOS terminal style) */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200/40 bg-white/60 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 mr-1">
            <button 
              type="button"
              onClick={() => setIsChatExpanded(false)}
              className="w-3 h-3 rounded-full bg-red-400/80 cursor-pointer hover:bg-red-500" 
              title="Close"
            />
            <span className="w-3 h-3 rounded-full bg-yellow-400/80 cursor-default" />
            <button 
              type="button"
              onClick={() => { synth.play("click"); setIsChatExpanded(!isChatExpanded); }}
              className="w-3 h-3 rounded-full bg-green-400/80 cursor-pointer hover:bg-green-500" 
              title="Toggle Fullscreen"
            />
          </div>
          
          {onToggleSidebar && (
            <button
              type="button"
              onClick={onToggleSidebar}
              className="px-2.5 py-1 text-xs font-bold rounded-lg border border-zinc-200 bg-white/80 hover:bg-zinc-950 hover:text-white transition-all cursor-pointer flex items-center gap-1 text-zinc-700 shadow-sm"
              title="View Chat Sessions"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
              <span>Chats</span>
            </button>
          )}

          {onNewChat && (
            <button
              type="button"
              onClick={onNewChat}
              className="px-2.5 py-1 text-xs font-bold rounded-lg bg-purple-600 text-white hover:bg-purple-700 transition-all cursor-pointer flex items-center gap-1 shadow-sm"
              title="Start a new chat window"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              <span>+ New Chat</span>
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <div className="w-6.5 h-6.5 rounded-full bg-zinc-900 border border-white/40 text-white font-bold text-[10px] flex items-center justify-center">Y</div>
          <span className="font-extrabold text-xs text-zinc-800 tracking-tight">Yug&apos;s AI</span>
          <div className="flex items-center gap-1 ml-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-[9.5px] font-extrabold text-emerald-600 uppercase tracking-wider">Online</span>
          </div>
          <button 
            type="button"
            onClick={() => { synth.play("click"); setIsChatExpanded(!isChatExpanded); }}
            className="ml-2 w-8 h-8 rounded-full border border-zinc-200/80 bg-white hover:bg-zinc-50 flex items-center justify-center cursor-pointer transition-all hover:scale-105"
            title={isChatExpanded ? "Exit Fullscreen" : "Enter Fullscreen"}
          >
            {isChatExpanded ? (
              <svg className="w-4 h-4 text-zinc-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 9L4 4m0 0l5 0m-5 0l0 5m11 5l5 5m0 0l-5 0m5 0l0-5m0-11l-5 5m5-5l-5 0m5 0l0 5m-16 11l5-5m-5 5l5 0m-5 0l0-5" /></svg>
            ) : (
              <svg className="w-4 h-4 text-zinc-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5v-4m0 4h-4m4 0l-5-5" /></svg>
            )}
          </button>
        </div>
      </div>

      {/* Chat Messages */}
      <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-5 text-[16.5px] chat-scroll bg-white/5">
        <AnimatePresence>
          {messages.map((msg, index) => (
            <motion.div 
              key={index}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex gap-3 max-w-[88%] ${msg.sender === "user" ? "ml-auto flex-row-reverse" : ""}`}
            >
              <div className={`px-4.5 py-3.5 rounded-[22px] ${
                msg.sender === "user" 
                  ? "bg-gradient-to-br from-purple-600 via-indigo-600 to-blue-600 text-white rounded-tr-none font-medium shadow-[0_10px_25px_-5px_rgba(99,102,241,0.4)] border border-purple-500/20" 
                  : "bg-white/80 border border-white text-zinc-800 rounded-tl-none font-medium leading-relaxed shadow-[0_4px_12px_rgba(0,0,0,0.015)] backdrop-blur-sm"
              } word-break`}>
                <p 
                  dangerouslySetInnerHTML={{ 
                    __html: msg.text
                      .replace(/\n/g, '<br/>')
                      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') 
                  }} 
                />
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {isTyping && (
          <div className="flex gap-3">
            <div className="px-5 py-4 bg-white/80 border border-white rounded-[22px] rounded-tl-none flex items-center gap-1.5 shadow-[0_4px_12px_rgba(0,0,0,0.015)]">
              <span className="w-2 h-2 rounded-full bg-indigo-500 typing-dot" />
              <span className="w-2 h-2 rounded-full bg-indigo-500 typing-dot" />
              <span className="w-2 h-2 rounded-full bg-indigo-500 typing-dot" />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Suggestions Horizontal Wrap ( Sleek Pills ) */}
      <div className="flex flex-wrap gap-2 p-5 border-t border-zinc-200/30 bg-white/40 select-none justify-center">
        {["Projects.", "Backend.", "AI.", "Startups.", "Experience."].map((chip) => (
          <button
            type="button"
            key={chip}
            onClick={() => handleQuery(chip.replace(".", ""))}
            disabled={isTyping}
            className="px-4 py-2 text-[11.5px] font-extrabold bg-white hover:bg-zinc-950 hover:text-white border border-zinc-200/70 hover:border-zinc-950 rounded-full transition-all shadow-[0_2px_6px_rgba(0,0,0,0.02)] cursor-pointer disabled:opacity-50"
          >
            {chip}
          </button>
        ))}
      </div>

      {/* Bottom input area */}
      <div className="p-5 bg-white/60 backdrop-blur-md border-t border-zinc-200/40 flex items-center gap-3">
        <div className="flex-1 bg-white border border-zinc-200/80 px-5 py-3 rounded-2xl flex items-center justify-between shadow-[0_2px_8px_rgba(0,0,0,0.01)] focus-within:border-indigo-500 focus-within:shadow-[0_0_12px_rgba(99,102,241,0.15)] transition-all">
          <input
            type="text"
            placeholder="Ask Yug's AI..."
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && chatInput.trim()) {
                handleQuery(chatInput.trim());
                setChatInput("");
              }
            }}
            className="flex-1 bg-transparent text-[15.5px] text-zinc-800 outline-none mr-2 font-medium placeholder-zinc-400"
          />
          <span className="text-zinc-400 text-xs">🎙️</span>
        </div>
        <button
          type="button"
          onClick={() => {
            if (chatInput.trim()) {
              handleQuery(chatInput.trim());
              setChatInput("");
            }
          }}
          className="w-11 h-11 rounded-2xl bg-gradient-to-br from-purple-600 to-indigo-600 text-white flex items-center justify-center hover:shadow-[0_8px_20px_-4px_rgba(99,102,241,0.45)] hover:scale-105 active:scale-95 transition-all flex-shrink-0 cursor-pointer"
        >
          <svg className="w-4.5 h-4.5 transform rotate-45 mr-0.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 19V5m-7 7l7-7 7 7" /></svg>
        </button>
      </div>
    </div>
  );
};
