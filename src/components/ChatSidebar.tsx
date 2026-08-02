import React, { useState, useEffect, useRef } from "react";
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
  hasMore: boolean;
  onLoadMore: () => void;
  isLoadingMore: boolean;
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

export const ChatSidebar: React.FC<ChatSidebarProps> = React.memo(({
  sessions,
  activeSessionId,
  onSelectSession,
  onNewChat,
  onDeleteSession,
  isLoading,
  isOpen,
  onClose,
  hasMore,
  onLoadMore,
  isLoadingMore,
}) => {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (confirmDeleteId === id) {
      onDeleteSession(id);
      setConfirmDeleteId(null);
    } else {
      setConfirmDeleteId(id);
      setTimeout(() => setConfirmDeleteId(null), 2000);
    }
  };

  // Implement scroll-to-load-more
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const handleScroll = () => {
      if (!hasMore || isLoadingMore || isLoading) return;
      // If we scrolled to the bottom of the list
      if (el.scrollHeight - el.scrollTop <= el.clientHeight + 40) {
        onLoadMore();
      }
    };

    el.addEventListener("scroll", handleScroll);
    return () => el.removeEventListener("scroll", handleScroll);
  }, [hasMore, isLoadingMore, isLoading, onLoadMore]);

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
            className="fixed inset-0 bg-black/40 z-[88] lg:hidden backdrop-blur-sm"
            onClick={onClose}
          />
        )}
      </AnimatePresence>

      {/* Sidebar Panel */}
      <motion.aside
        initial={false}
        animate={{ x: isOpen ? 0 : "-100%" }}
        transition={{ type: "spring", stiffness: 380, damping: 35 }}
        className="fixed top-0 left-0 h-full w-[290px] z-[89] flex flex-col"
        style={{
          background: "rgba(10, 10, 14, 0.94)",
          backdropFilter: "blur(32px)",
          borderRight: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-6 pb-4 border-b border-white/5">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-purple-600 via-indigo-600 to-blue-600 flex items-center justify-center font-bold text-white text-xs shadow-md shadow-indigo-900/20">
              Y
            </div>
            <span className="font-extrabold text-[15px] text-white tracking-tight bg-gradient-to-r from-zinc-100 to-zinc-400 bg-clip-text text-transparent">
              Chat History
            </span>
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
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 text-white font-bold text-xs hover:shadow-[0_0_20px_rgba(124,58,237,0.3)] transition-all active:scale-[0.98] cursor-pointer"
          >
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            New Chat
          </button>
        </div>

        {/* Sessions List */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto px-3 pt-3 pb-2 flex flex-col gap-1.5 custom-scroll-dark"
        >
          {isLoading && sessions.length === 0 ? (
            <div className="flex flex-col gap-3 py-6 px-2">
              {[1, 2, 3, 4].map((n) => (
                <div key={n} className="flex items-center gap-3 px-3 py-3 rounded-xl bg-white/3 animate-pulse">
                  <div className="w-7 h-7 rounded-lg bg-white/5 flex-shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-2.5 bg-white/10 rounded w-3/4" />
                    <div className="h-2 bg-white/5 rounded w-1/4" />
                  </div>
                </div>
              ))}
            </div>
          ) : sessions.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-zinc-500 text-xs font-semibold">No chats yet</p>
              <p className="text-zinc-600 text-[10.5px] mt-1">Start a new conversation</p>
            </div>
          ) : (
            <>
              <AnimatePresence initial={false}>
                {sessions.map((session) => (
                  <motion.div
                    key={session._id}
                    layout="position"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={{ duration: 0.2 }}
                    onMouseEnter={() => setHoveredId(session._id)}
                    onMouseLeave={() => setHoveredId(null)}
                    onClick={() => onSelectSession(session._id)}
                    className={`
                      group relative flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-all border
                      ${activeSessionId === session._id
                        ? "bg-white/8 border-white/10 shadow-lg shadow-black/10"
                        : "hover:bg-white/4 border-transparent"
                      }
                    `}
                  >
                    {/* Chat icon */}
                    <div className={`flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center transition-all ${
                      activeSessionId === session._id
                        ? "bg-indigo-600/30 text-indigo-400"
                        : "bg-white/5 text-zinc-500 group-hover:bg-white/8 group-hover:text-zinc-300"
                    }`}>
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
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
                      <p className="text-[9.5px] text-zinc-500 font-medium mt-0.5">{timeAgo(session.updated_at)}</p>
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
                              ? "bg-red-500/25 text-red-400"
                              : "text-zinc-600 hover:text-red-400 hover:bg-red-500/10"
                          }`}
                          title={confirmDeleteId === session._id ? "Confirm Delete" : "Delete Chat"}
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </motion.button>
                      )}
                    </AnimatePresence>
                  </motion.div>
                ))}
              </AnimatePresence>

              {/* Loader indicator / Load More manual trigger */}
              {hasMore && (
                <div className="pt-2 pb-4 text-center">
                  {isLoadingMore ? (
                    <div className="flex items-center justify-center py-2 gap-2">
                      <div className="w-4 h-4 rounded-full border border-purple-500 border-t-transparent animate-spin" />
                      <span className="text-[10px] text-zinc-500 font-semibold">Loading more chats...</span>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={onLoadMore}
                      className="text-[10px] text-purple-400 font-bold hover:text-purple-300 hover:underline px-3 py-1.5 rounded-lg hover:bg-white/3 transition-all cursor-pointer"
                    >
                      Load More
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-white/5">
          <p className="text-[9.5px] text-zinc-600 font-bold text-center tracking-wider">
            POWERED BY GROQ + MONGODB
          </p>
        </div>
      </motion.aside>
    </>
  );
});

ChatSidebar.displayName = "ChatSidebar";
