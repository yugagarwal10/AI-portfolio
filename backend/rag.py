"""
Production-Level RAG Engine for yug.ai Portfolio
─────────────────────────────────────────────────
Embedding  : sentence-transformers (all-MiniLM-L6-v2) — local, zero-cost
LLM        : Groq → llama-3.3-70b-versatile
Chunking   : Section-aware + sliding window with overlap
Retrieval  : Cosine similarity + score threshold reranking
Memory     : Per-session conversation history (last N turns)
Streaming  : Token-level SSE via Groq streaming API
"""

import os
import re
import json
import math
import hashlib
import logging
from pathlib import Path
from typing import Generator

import numpy as np
from groq import Groq
from dotenv import load_dotenv
from sentence_transformers import SentenceTransformer

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

# ── Constants ──────────────────────────────────────────────────────────────────
CACHE_FILE        = Path("data/embeddings_cache.json")
DATA_DIR          = Path("data")
EMBED_MODEL_NAME  = "all-MiniLM-L6-v2"   # 22MB, fast, accurate
GROQ_LLM_MODEL    = "llama-3.3-70b-versatile"
CHUNK_SIZE        = 400    # tokens approx (words)
CHUNK_OVERLAP     = 80     # overlap between sliding-window chunks
TOP_K             = 4      # retrieve top N chunks
SCORE_THRESHOLD   = 0.25   # discard chunks below this similarity
MAX_HISTORY_TURNS = 6      # keep last 6 user+ai turns in context


# ── Helpers ────────────────────────────────────────────────────────────────────
def cosine_similarity(a: list[float], b: list[float]) -> float:
    va = np.array(a, dtype=np.float32)
    vb = np.array(b, dtype=np.float32)
    denom = np.linalg.norm(va) * np.linalg.norm(vb)
    return float(np.dot(va, vb) / denom) if denom > 0 else 0.0


def _hash_chunks(chunks: list[str]) -> str:
    combined = "||".join(chunks)
    return hashlib.md5(combined.encode()).hexdigest()


# ── Chunker ────────────────────────────────────────────────────────────────────
class DocumentChunker:
    """
    Two-phase chunker:
    1. Split on explicit section markers (---  SECTION:)
    2. Sliding-window sub-chunk any section that's too large
    """

    def chunk(self, text: str) -> list[dict]:
        # Phase 1: section-level split
        raw_sections = re.split(r"(?m)^---\s*$", text)
        sections = [s.strip() for s in raw_sections if s.strip()]

        chunks: list[dict] = []
        for section in sections:
            # Extract a label from first line if it has SECTION:
            label_match = re.match(r"SECTION:\s*(.+)", section.splitlines()[0])
            label = label_match.group(1).strip() if label_match else "General"

            words = section.split()
            if len(words) <= CHUNK_SIZE:
                chunks.append({"text": section, "source": label})
            else:
                # Sliding window sub-chunks
                start = 0
                while start < len(words):
                    end = min(start + CHUNK_SIZE, len(words))
                    chunk_text = " ".join(words[start:end])
                    chunks.append({"text": chunk_text, "source": label})
                    if end == len(words):
                        break
                    start += CHUNK_SIZE - CHUNK_OVERLAP

        logger.info(f"Chunker produced {len(chunks)} chunks.")
        return chunks


# ── RAG Engine ─────────────────────────────────────────────────────────────────
class PortfolioRAG:
    def __init__(self, data_dir: str = "data"):
        self.data_dir = Path(data_dir)
        self.chunks: list[dict] = []          # [{"text": ..., "source": ...}]
        self.embeddings: list[list[float]] = []
        self._sessions: dict[str, list[dict]] = {}  # session_id → history

        # Groq client
        api_key = os.getenv("GROQ_API_KEY")
        if not api_key:
            raise RuntimeError("GROQ_API_KEY not set in .env")
        self.groq = Groq(api_key=api_key)

        # Load local embedding model (downloads once, ~22MB)
        logger.info(f"Loading embedding model: {EMBED_MODEL_NAME}")
        self.embedder = SentenceTransformer(EMBED_MODEL_NAME)
        logger.info("Embedding model loaded.")

        self._load_all_documents()

    # ── Document Loading ───────────────────────────────────────────────────────
    def _load_all_documents(self):
        """Load all .txt files from data directory."""
        txt_files = list(self.data_dir.glob("*.txt"))
        if not txt_files:
            raise FileNotFoundError(f"No .txt files found in {self.data_dir}")

        chunker = DocumentChunker()
        all_chunks: list[dict] = []

        for fp in txt_files:
            logger.info(f"Loading document: {fp.name}")
            content = fp.read_text(encoding="utf-8")
            file_chunks = chunker.chunk(content)
            # Tag each chunk with its source file too
            for c in file_chunks:
                c["file"] = fp.name
            all_chunks.extend(file_chunks)

        self.chunks = all_chunks
        logger.info(f"Total chunks indexed: {len(self.chunks)}")
        self._load_or_generate_embeddings()

    # ── Embedding Cache ────────────────────────────────────────────────────────
    def _load_or_generate_embeddings(self):
        chunk_texts = [c["text"] for c in self.chunks]
        current_hash = _hash_chunks(chunk_texts)

        if CACHE_FILE.exists():
            try:
                cache = json.loads(CACHE_FILE.read_text(encoding="utf-8"))
                if cache.get("hash") == current_hash:
                    self.embeddings = cache["embeddings"]
                    logger.info(f"Loaded {len(self.embeddings)} embeddings from cache.")
                    return
                logger.info("Document changed — regenerating embeddings...")
            except Exception as e:
                logger.warning(f"Cache read error: {e}. Regenerating...")

        logger.info("Generating embeddings with sentence-transformers...")
        vecs = self.embedder.encode(chunk_texts, show_progress_bar=True, convert_to_numpy=True)
        self.embeddings = vecs.tolist()

        CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
        CACHE_FILE.write_text(
            json.dumps({"hash": current_hash, "embeddings": self.embeddings}),
            encoding="utf-8"
        )
        logger.info(f"Embeddings saved to {CACHE_FILE}.")

    # ── Retrieval ──────────────────────────────────────────────────────────────
    def retrieve(self, query: str, top_k: int = TOP_K) -> list[dict]:
        """Embed query, rank chunks by cosine similarity, apply threshold."""
        if not self.chunks:
            return []

        q_vec = self.embedder.encode([query], convert_to_numpy=True)[0].tolist()

        scored = [
            (cosine_similarity(q_vec, emb), i)
            for i, emb in enumerate(self.embeddings)
        ]
        scored.sort(key=lambda x: x[0], reverse=True)

        results = []
        for score, idx in scored[:top_k]:
            if score < SCORE_THRESHOLD:
                logger.debug(f"Chunk {idx} below threshold ({score:.3f}), skipping.")
                break
            results.append({
                "text": self.chunks[idx]["text"],
                "source": self.chunks[idx]["source"],
                "score": round(score, 4),
            })

        logger.info(f"Retrieved {len(results)} chunks for query: '{query[:60]}...'")
        return results

    # ── Session Memory ─────────────────────────────────────────────────────────
    def get_history(self, session_id: str) -> list[dict]:
        if session_id not in self._sessions:
            # Hydrate from MongoDB if available
            try:
                import database as db
                mongo_msgs = db.get_messages(session_id)
                if mongo_msgs:
                    formatted = []
                    for m in mongo_msgs:
                        formatted.append({"role": m["role"], "content": m["text"]})
                    max_msgs = MAX_HISTORY_TURNS * 2
                    self._sessions[session_id] = formatted[-max_msgs:]
            except Exception as e:
                logger.warning(f"Could not load history from MongoDB for {session_id}: {e}")
        return self._sessions.get(session_id, [])

    def add_to_history(self, session_id: str, role: str, content: str):
        if session_id not in self._sessions:
            self._sessions[session_id] = []
        self._sessions[session_id].append({"role": role, "content": content})
        # Keep only last N turns (user+ai = 2 msgs per turn)
        max_msgs = MAX_HISTORY_TURNS * 2
        if len(self._sessions[session_id]) > max_msgs:
            self._sessions[session_id] = self._sessions[session_id][-max_msgs:]

    def clear_session(self, session_id: str):
        self._sessions.pop(session_id, None)

    # ── Answer Generation (streaming) ─────────────────────────────────────────
    def ask_stream(self, query: str, session_id: str = "default") -> Generator[str, None, None]:
        """Yield token chunks as SSE-compatible strings."""
        history = self.get_history(session_id)

        # Contextual retrieval: If user query is a follow-up ("tell me more about it", etc.)
        # combine with previous user query from history to retrieve relevant documents.
        retrieval_query = query
        if history:
            last_user_msgs = [h["content"] for h in history if h["role"] == "user"]
            if last_user_msgs:
                # Append last user topic if current query is short or ambiguous
                if len(query.split()) < 10 or any(kw in query.lower() for kw in ["it", "this", "that", "more", "tell", "explain", "kya", "aur"]):
                    retrieval_query = f"{last_user_msgs[-1]} {query}"

        retrieved = self.retrieve(retrieval_query)

        if retrieved:
            context_text = "\n\n---\n\n".join(
                f"[Source: {r['source']} | Score: {r['score']}]\n{r['text']}"
                for r in retrieved
            )
        else:
            context_text = "No relevant context found in portfolio data."

        system_prompt = f"""You are Yug's AI — a sharp, professional portfolio assistant for Yugen Agarwal (Yug).

CORE RULES:
1. ACCURACY: ONLY use facts present in the Retrieved Context below. Never hallucinate.
   If info is missing, say: "I don't have that info — reach Yug at yugagarwal214@gmail.com."
2. COMPENSATION: Never discuss salary, pricing, rates, or budgets.
   Redirect: "For offers, contact Yug directly at yugagarwal214@gmail.com."
3. TONE: Be concise, confident, and warm. You represent Yug professionally.
4. FORMAT: Use **bold** for key terms. Keep answers focused and scannable.
5. CONTEXT & MEMORY: Remember previous user messages in history. Answer follow-up questions ("tell me more", "what about it", etc.) using the conversation context.
6. OFF-TOPIC: Politely decline anything unrelated to Yug's professional profile.

Retrieved Context:
{context_text}"""

        messages = [{"role": "system", "content": system_prompt}]
        messages.extend(history)
        messages.append({"role": "user", "content": query})

        # Store user message in history
        self.add_to_history(session_id, "user", query)

        full_response = ""
        try:
            stream = self.groq.chat.completions.create(
                model=GROQ_LLM_MODEL,
                messages=messages,
                temperature=0.35,
                max_tokens=600,
                stream=True,
            )
            for chunk in stream:
                delta = chunk.choices[0].delta.content
                if delta:
                    full_response += delta
                    yield delta

        except Exception as e:
            err_msg = f"⚠️ LLM error: {str(e)}"
            logger.error(err_msg)
            yield err_msg
            return

        # Store AI response in history
        self.add_to_history(session_id, "assistant", full_response)

    def ask(self, query: str, session_id: str = "default") -> str:
        """Non-streaming version — collects full response."""
        return "".join(self.ask_stream(query, session_id))

