import React, { useRef, useEffect } from "react";
import { motion } from "framer-motion";
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

const formatMessageText = (text: string) => {
  // Normalize standard bold formatting **bold**
  let formatted = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  
  // Convert bullet points with '+' or '*' followed by space into clean block style
  const lines = formatted.split("\n");
  let inList = false;
  const formattedLines = lines.map((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("+ ") || trimmed.startsWith("* ")) {
      const content = trimmed.substring(2);
      let listElement = "";
      if (!inList) {
        inList = true;
        listElement = `<ul class="list-disc pl-5 mt-1 space-y-1">`;
      }
      return `${listElement}<li class="text-zinc-700 font-normal dark:text-zinc-300">${content}</li>`;
    } else {
      let prefix = "";
      if (inList) {
        inList = false;
        prefix = "</ul>";
      }
      return prefix + (trimmed ? `<p>${trimmed}</p>` : "");
    }
  });
  
  if (inList) {
    formattedLines.push("</ul>");
  }
  
  return formattedLines.join("");
};

// Memoized individual message item to prevent redundant rendering of old messages
const MessageItem = React.memo<{ msg: Message }>(({ msg }) => {
  const isUser = msg.sender === "user";
  
  return (
    <motion.div 
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className={`flex gap-3 max-w-[85%] ${isUser ? "ml-auto flex-row-reverse" : ""}`}
    >
      <div className={`px-4.5 py-3.5 rounded-[22px] ${
        isUser 
          ? "bg-gradient-to-br from-purple-600 via-indigo-600 to-blue-600 text-white rounded-tr-none font-medium shadow-md shadow-indigo-900/10 border border-purple-500/10" 
          : "bg-white/90 border border-zinc-200/50 text-zinc-800 rounded-tl-none font-medium leading-relaxed shadow-sm backdrop-blur-sm"
      } word-break`}>
        <div 
          className={`prose-chat text-[14.5px] lg:text-[15.5px] space-y-1.5 ${isUser ? "text-white" : "text-zinc-800"}`}
          dangerouslySetInnerHTML={{ __html: formatMessageText(msg.text) }} 
        />
      </div>
    </motion.div>
  );
});

MessageItem.displayName = "MessageItem";

export const ChatContainer: React.FC<ChatContainerProps> = React.memo(({
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
    // Only scroll smoothly
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, isTyping]);

  return (
    <div className={`
      flex flex-col rounded-[32px] glass-panel overflow-hidden border border-white/60 shadow-[0_25px_60px_-15px_rgba(124,58,237,0.08)] transition-all duration-500 ease-in-out
      ${isChatExpanded 
        ? "fixed inset-6 z-[99] w-[calc(100vw-48px)] h-[calc(100vh-48px)] shadow-[0_30px_100px_rgba(124,58,237,0.2)] scale-100" 
        : "relative lg:col-span-5 w-full h-[520px] lg:h-[calc(100vh-160px)] lg:max-h-[640px] scale-100"
      }
    `}>
      
      {/* Top Bar Header (macOS terminal style) */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200/30 bg-white/70 backdrop-blur-md">
        <div className="flex items-center gap-2">
          
          {onToggleSidebar && (
            <button
              type="button"
              onClick={onToggleSidebar}
              className="px-2.5 py-1 text-xs font-bold rounded-lg border border-zinc-200 bg-white hover:bg-zinc-950 hover:text-white transition-all cursor-pointer flex items-center gap-1 text-zinc-700 shadow-sm"
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
              <span>New Chat</span>
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
      <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-5 text-[16px] chat-scroll bg-zinc-50/20">
        {messages.map((msg, index) => (
          <MessageItem key={index + msg.sender + msg.text.slice(0, 8)} msg={msg} />
        ))}

        {isTyping && (
          <div className="flex gap-3">
            <div className="px-5 py-4 bg-white/90 border border-zinc-200/50 rounded-[22px] rounded-tl-none flex items-center gap-1.5 shadow-sm">
              <span className="w-2 h-2 rounded-full bg-indigo-500 typing-dot" />
              <span className="w-2 h-2 rounded-full bg-indigo-500 typing-dot" />
              <span className="w-2 h-2 rounded-full bg-indigo-500 typing-dot" />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Bottom input area */}
      <div className="p-5 bg-white/70 backdrop-blur-md border-t border-zinc-200/30 flex items-center gap-3">
        <div className="flex-1 bg-white border border-zinc-200 px-5 py-3 rounded-2xl flex items-center justify-between shadow-sm focus-within:border-indigo-500 focus-within:shadow-[0_0_12px_rgba(99,102,241,0.1)] transition-all">
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
            className="flex-1 bg-transparent text-[15px] text-zinc-800 outline-none mr-2 font-medium placeholder-zinc-400"
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
          className="w-11 h-11 rounded-2xl bg-gradient-to-br from-purple-600 to-indigo-600 text-white flex items-center justify-center hover:shadow-[0_8px_20px_-4px_rgba(99,102,241,0.3)] hover:scale-105 active:scale-95 transition-all flex-shrink-0 cursor-pointer"
        >
          <svg className="w-4.5 h-4.5 transform rotate-45 mr-0.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 19V5m-7 7l7-7 7 7" /></svg>
        </button>
      </div>
    </div>
  );
});

ChatContainer.displayName = "ChatContainer";
