import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

export interface ChatSession {
  _id: string;
  title: string;
  updated_at: string;
  created_at: string;
}

interface ChatSidebarProps {
  sessions: ChatSession[];
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
  onNewChat: () => void;
  onDeleteSession: (id: string) => void;
  isLoading: boolean;
  isOpen: boolean;
  onClose: () => void;
}

function timeAgo(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const diff = Math.floor((now - then) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export const ChatSidebar: React.FC<ChatSidebarProps> = ({
  sessions,
  activeSessionId,
  onSelectSession,
  onNewChat,
  onDeleteSession,
  isLoading,
  isOpen,
  onClose,
}) => {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (confirmDeleteId === id) {
      onDeleteSession(id);
      setConfirmDeleteId(null);
    } else {
      setConfirmDeleteId(id);
      // Auto-cancel confirm after 2s
      setTimeout(() => setConfirmDeleteId(null), 2000);
    }
  };

  return (
    <>
      {/* Backdrop for mobile */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/30 z-[88] lg:hidden"
            onClick={onClose}
          />
        )}
      </AnimatePresence>

      {/* Sidebar Panel */}
      <motion.aside
        initial={false}
        animate={{ x: isOpen ? 0 : "-100%" }}
        transition={{ type: "spring", stiffness: 320, damping: 32 }}
        className="fixed top-0 left-0 h-full w-[280px] z-[89] flex flex-col"
        style={{
          background: "rgba(9,9,11,0.96)",
          backdropFilter: "blur(24px)",
          borderRight: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-6 pb-4 border-b border-white/8">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-purple-600 to-indigo-600 flex items-center justify-center font-bold text-white text-xs">
              Y
            </div>
            <span className="font-bold text-sm text-white tracking-tight">Chat History</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded-full flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/10 transition-all cursor-pointer"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* New Chat Button */}
        <div className="px-4 pt-4">
          <button
            type="button"
            onClick={onNewChat}
            className="w-full flex items-center gap-2.5 px-4 py-3 rounded-2xl bg-gradient-to-r from-purple-600 to-indigo-600 text-white font-bold text-sm hover:shadow-[0_0_20px_rgba(124,58,237,0.4)] transition-all active:scale-95 cursor-pointer"
          >
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            New Chat
          </button>
        </div>

        {/* Sessions List */}
        <div className="flex-1 overflow-y-auto px-3 pt-3 pb-4 flex flex-col gap-1 custom-scroll-dark">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-5 h-5 rounded-full border-2 border-purple-500 border-t-transparent animate-spin" />
            </div>
          ) : sessions.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-zinc-500 text-xs font-medium">No chats yet</p>
              <p className="text-zinc-600 text-xs mt-1">Start a new conversation</p>
            </div>
          ) : (
            <AnimatePresence>
              {sessions.map((session) => (
                <motion.div
                  key={session._id}
                  layout
                  initial={{ opacity: 0, x: -16 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -16 }}
                  onMouseEnter={() => setHoveredId(session._id)}
                  onMouseLeave={() => setHoveredId(null)}
                  onClick={() => onSelectSession(session._id)}
                  className={`
                    group relative flex items-center gap-3 px-3.5 py-3 rounded-xl cursor-pointer transition-all
                    ${activeSessionId === session._id
                      ? "bg-white/10 border border-white/10"
                      : "hover:bg-white/6 border border-transparent"
                    }
                  `}
                >
                  {/* Chat icon */}
                  <div className={`flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center transition-all ${
                    activeSessionId === session._id
                      ? "bg-purple-600/40"
                      : "bg-white/6 group-hover:bg-white/10"
                  }`}>
                    <svg className="w-3.5 h-3.5 text-zinc-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                  </div>

                  {/* Title & time */}
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs font-semibold truncate transition-colors ${
                      activeSessionId === session._id ? "text-white" : "text-zinc-400 group-hover:text-zinc-200"
                    }`}>
                      {session.title}
                    </p>
                    <p className="text-[10px] text-zinc-600 mt-0.5">{timeAgo(session.updated_at)}</p>
                  </div>

                  {/* Delete button */}
                  <AnimatePresence>
                    {(hoveredId === session._id || activeSessionId === session._id) && (
                      <motion.button
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.8 }}
                        type="button"
                        onClick={(e) => handleDelete(e, session._id)}
                        className={`flex-shrink-0 w-6 h-6 rounded-lg flex items-center justify-center transition-all cursor-pointer ${
                          confirmDeleteId === session._id
                            ? "bg-red-500/30 text-red-400"
                            : "text-zinc-600 hover:text-red-400 hover:bg-red-500/20"
                        }`}
                        title={confirmDeleteId === session._id ? "Click again to confirm" : "Delete chat"}
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </motion.button>
                    )}
                  </AnimatePresence>
                </motion.div>
              ))}
            </AnimatePresence>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-white/8">
          <p className="text-[10px] text-zinc-600 font-medium text-center">Powered by Groq + MongoDB</p>
        </div>
      </motion.aside>
    </>
  );
};
