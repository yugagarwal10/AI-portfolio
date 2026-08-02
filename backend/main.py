"""
yug.ai — FastAPI Backend v3.0
RAG API + MongoDB-backed multi-session chat storage.
"""

import logging
import uuid
import threading
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, field_validator

from rag import PortfolioRAG
import database as db

logger = logging.getLogger(__name__)

# ── App lifecycle ──────────────────────────────────────────────────────────────
rag: PortfolioRAG | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global rag
    # Init MongoDB indexes
    try:
        db.init_indexes()
    except Exception as e:
        logger.warning(f"MongoDB init warning: {e}")
    # Init RAG engine
    try:
        rag = PortfolioRAG()
        logger.info("RAG engine initialized successfully.")
    except Exception as e:
        logger.error(f"RAG engine failed to initialize: {e}")
        rag = None

    # ── Start file watcher (auto-reload on new/modified .txt in data/) ────────
    watcher_thread = threading.Thread(target=_start_file_watcher, daemon=True)
    watcher_thread.start()
    logger.info("👁️  File watcher started on data/ directory.")

    yield
    logger.info("Shutting down.")


# ── FastAPI app ────────────────────────────────────────────────────────────────
app = FastAPI(
    title="yug.ai RAG API",
    description="Production RAG backend — Yugen Agarwal AI Portfolio Assistant.",
    version="3.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Schemas ────────────────────────────────────────────────────────────────────
class QueryRequest(BaseModel):
    query: str
    session_id: str = ""

    @field_validator("query")
    @classmethod
    def query_must_not_be_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Query cannot be empty.")
        if len(v) > 1000:
            raise ValueError("Query exceeds 1000-character limit.")
        return v.strip()


class ClearRequest(BaseModel):
    session_id: str


class NewSessionRequest(BaseModel):
    title: str = "New Chat"


class RenameSessionRequest(BaseModel):
    title: str


# ── File Watcher ──────────────────────────────────────────────────────────────────────────────────────
_WATCH_DIR = Path("data")
_reload_lock = threading.Lock()


def _start_file_watcher():
    """Watch data/ for new or modified .txt files and auto-reload RAG."""
    try:
        from watchdog.observers import Observer
        from watchdog.events import FileSystemEventHandler

        class _Handler(FileSystemEventHandler):
            def _should_handle(self, path: str) -> bool:
                return path.endswith(".txt")

            def on_created(self, event):
                if not event.is_directory and self._should_handle(event.src_path):
                    logger.info(f"📥 New file detected: {event.src_path} — triggering reload...")
                    _trigger_reload()

            def on_modified(self, event):
                if not event.is_directory and self._should_handle(event.src_path):
                    logger.info(f"✏️  File modified: {event.src_path} — triggering reload...")
                    _trigger_reload()

        observer = Observer()
        observer.schedule(_Handler(), str(_WATCH_DIR), recursive=False)
        observer.start()
        observer.join()  # blocks the daemon thread

    except ImportError:
        logger.warning(
            "⚠️  watchdog not installed — auto file-reload disabled. "
            "Run: pip install watchdog"
        )


def _trigger_reload():
    """Debounced reload — only one reload runs at a time."""
    if not _reload_lock.acquire(blocking=False):
        logger.info("Reload already in progress, skipping duplicate trigger.")
        return
    try:
        if rag:
            rag.reload()
            logger.info("✅ Auto-reload complete.")
    except Exception as e:
        logger.error(f"Auto-reload failed: {e}")
    finally:
        _reload_lock.release()


# ── Health ──────────────────────────────────────────────────────────────────────────────────────
@app.get("/", tags=["Health"])
def health_check():
    return {
        "status": "operational",
        "rag_ready": rag is not None,
        "engine": "sentence-transformers + Groq llama-3.3-70b-versatile + MongoDB",
        "version": "3.0.0",
    }


@app.get("/health", tags=["Health"])
def detailed_health():
    if rag is None:
        raise HTTPException(status_code=503, detail="RAG engine not ready.")
    return {
        "status": "ok",
        "chunks_indexed": len(rag.chunks),
        "active_rag_sessions": len(rag._sessions),
    }


@app.post("/admin/reload", tags=["Admin"])
def manual_reload():
    """Manually trigger a hot-reload of all data/*.txt files into RAG."""
    _require_rag()
    try:
        result = rag.reload()
        return {
            "status": "reloaded",
            "old_chunks": result["old_chunks"],
            "new_chunks": result["new_chunks"],
        }
    except Exception as e:
        logger.error(f"/admin/reload error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ── RAG Query Routes ───────────────────────────────────────────────────────────
@app.post("/query", tags=["RAG"])
def query_rag(request: QueryRequest):
    """Non-streaming query. Saves both user message and AI answer to MongoDB."""
    _require_rag()
    session_id = request.session_id or str(uuid.uuid4())

    # Save user message to MongoDB
    _try_save_message(session_id, "user", request.query)

    try:
        answer = rag.ask(request.query, session_id)
        # Save AI response to MongoDB
        _try_save_message(session_id, "assistant", answer)
        # Auto-title the session from the first user message
        _try_auto_title(session_id, request.query)
        return {"answer": answer, "session_id": session_id}
    except Exception as e:
        logger.error(f"/query error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/query/stream", tags=["RAG"])
def query_rag_stream(request: QueryRequest):
    """
    Streaming SSE endpoint. Saves messages to MongoDB after stream completes.
    Events: session:<id>, data:<token>, data:[DONE], event:error
    """
    _require_rag()
    session_id = request.session_id or str(uuid.uuid4())

    # Save user message immediately
    _try_save_message(session_id, "user", request.query)
    _try_auto_title(session_id, request.query)

    def event_generator():
        yield f"event: session\ndata: {session_id}\n\n"
        full_response = ""
        try:
            for token in rag.ask_stream(request.query, session_id):
                safe_token = token.replace("\n", "\\n")
                full_response += token
                yield f"data: {safe_token}\n\n"
        except Exception as e:
            yield f"event: error\ndata: {str(e)}\n\n"
        else:
            # Persist completed AI response to MongoDB
            _try_save_message(session_id, "assistant", full_response)
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── Session (RAG in-memory) ────────────────────────────────────────────────────
@app.post("/session/clear", tags=["Session"])
def clear_session(request: ClearRequest):
    if rag:
        rag.clear_session(request.session_id)
    return {"cleared": True, "session_id": request.session_id}


# ── Chat Sessions (MongoDB) ────────────────────────────────────────────────────
@app.get("/chats", tags=["Chats"])
def list_chats(limit: int = 10, skip: int = 0):
    """Return all chat sessions sorted by most recent activity."""
    try:
        sessions = db.list_sessions(limit=limit, skip=skip)
        total = db.get_sessions_col().count_documents({})
        return {"sessions": sessions, "total": total}
    except Exception as e:
        logger.error(f"/chats list error: {e}")
        raise HTTPException(status_code=500, detail="Database unavailable.")


@app.post("/chats", tags=["Chats"])
def create_chat(body: NewSessionRequest):
    """Create a new blank chat session."""
    try:
        session = db.create_session(title=body.title)
        return session
    except Exception as e:
        logger.error(f"/chats create error: {e}")
        raise HTTPException(status_code=500, detail="Could not create session.")


@app.get("/chats/{session_id}/messages", tags=["Chats"])
def get_chat_messages(session_id: str):
    """Return all messages for a specific chat session."""
    try:
        messages = db.get_messages(session_id)
        return {"session_id": session_id, "messages": messages}
    except Exception as e:
        logger.error(f"/chats/{session_id}/messages error: {e}")
        raise HTTPException(status_code=500, detail="Could not fetch messages.")


@app.patch("/chats/{session_id}", tags=["Chats"])
def rename_chat(session_id: str, body: RenameSessionRequest):
    """Rename a chat session."""
    try:
        db.update_session_title(session_id, body.title)
        return {"renamed": True, "session_id": session_id, "title": body.title}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/chats/{session_id}", tags=["Chats"])
def delete_chat(session_id: str):
    """Delete a chat session and all its messages."""
    try:
        db.delete_session(session_id)
        if rag:
            rag.clear_session(session_id)
        return {"deleted": True, "session_id": session_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Internal helpers ───────────────────────────────────────────────────────────
def _require_rag():
    if rag is None:
        raise HTTPException(status_code=503, detail="RAG engine not ready.")


def _try_save_message(session_id: str, role: str, text: str):
    try:
        # Ensure the session document exists in MongoDB with matching session_id
        if not db.get_session(session_id):
            db.create_session(session_id=session_id, title="New Chat")
        db.save_message(session_id, role, text)
    except Exception as e:
        logger.warning(f"Could not save message to MongoDB: {e}")


def _try_auto_title(session_id: str, user_query: str):
    """Set session title from first message (truncated to 40 chars)."""
    try:
        session = db.get_session(session_id)
        if session and session.get("title") in ("New Chat", ""):
            title = user_query[:40] + ("..." if len(user_query) > 40 else "")
            db.update_session_title(session_id, title)
    except Exception as e:
        logger.warning(f"Could not auto-title session: {e}")



# ── Dev entrypoint ─────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)
