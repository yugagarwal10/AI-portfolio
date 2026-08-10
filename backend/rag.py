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
import time
import hashlib
import logging
from pathlib import Path
from typing import Generator
from collections import defaultdict

import numpy as np
from groq import Groq, RateLimitError
from dotenv import load_dotenv
import requests

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

# ── Constants ──────────────────────────────────────────────────────────────────
_CURRENT_DIR      = Path(__file__).resolve().parent
CACHE_FILE        = _CURRENT_DIR / "data/embeddings_cache.json"
DATA_DIR          = _CURRENT_DIR / "data"
EMBED_MODEL_NAME  = "all-MiniLM-L6-v2"   # 22MB, fast, accurate
GROQ_LLM_MODEL    = "llama-3.3-70b-versatile"
GROQ_FALLBACK_MODEL = "llama-3.1-8b-instant"
CHUNK_SIZE        = 220    # tokens approx (words) — optimized to save tokens
CHUNK_OVERLAP     = 40     # overlap between sliding-window chunks
TOP_K             = 3      # retrieve top N chunks (optimized to save tokens)
SCORE_THRESHOLD   = 0.22   # filter out low-quality matches to save context
MAX_HISTORY_TURNS = 3      # keep last 3 user+ai turns in context (saves history tokens)


# ── Helpers ────────────────────────────────────────────────────────────────────
def cosine_similarity(a: list[float], b: list[float]) -> float:
    va = np.array(a, dtype=np.float32)
    vb = np.array(b, dtype=np.float32)
    denom = np.linalg.norm(va) * np.linalg.norm(vb)
    return float(np.dot(va, vb) / denom) if denom > 0 else 0.0


def _hash_chunks(chunks: list[str]) -> str:
    combined = "||".join(chunks)
    return hashlib.md5(combined.encode()).hexdigest()


def get_huggingface_embedding(texts: list[str]) -> list[list[float]]:
    """Fetch embeddings from Hugging Face Inference API with automatic retry."""
    api_url = f"https://api-inference.huggingface.co/models/sentence-transformers/{EMBED_MODEL_NAME}"
    hf_token = os.getenv("HF_API_KEY")
    headers = {}
    if hf_token:
        headers["Authorization"] = f"Bearer {hf_token}"
        
    for attempt in range(3):
        try:
            response = requests.post(
                api_url,
                headers=headers,
                json={"inputs": texts, "options": {"wait_for_model": True}},
                timeout=10
            )
            if response.status_code == 200:
                res_json = response.json()
                if isinstance(res_json, list):
                    if len(texts) == 1 and res_json and not isinstance(res_json[0], list):
                        return [res_json]
                    return res_json
                else:
                    raise ValueError(f"Unexpected response format from Hugging Face API: {res_json}")
            elif response.status_code == 503:
                logger.warning(f"Hugging Face model is loading (attempt {attempt+1}/3). Waiting...")
                time.sleep(3)
                continue
            else:
                raise Exception(f"HF API Error {response.status_code}: {response.text}")
        except Exception as e:
            logger.warning(f"HF API request failed (attempt {attempt+1}/3): {e}")
            if attempt == 2:
                raise e
            time.sleep(1)
            
    raise Exception("Hugging Face API failed after retries.")


class SimpleBM25:
    """A pure Python implementation of the BM25 retrieval algorithm for zero-dependency local search."""
    def __init__(self, corpus: list[str], b: float = 0.75, k1: float = 1.5):
        self.b = b
        self.k1 = k1
        self.corpus_size = len(corpus)
        self.avg_doc_len = 0.0
        self.doc_lens = []
        self.doc_term_freqs = []
        self.vocab = set()
        self.df = defaultdict(int)

        def tokenize(text: str) -> list[str]:
            return re.findall(r"\w+", text.lower())

        total_len = 0
        for doc in corpus:
            tokens = tokenize(doc)
            doc_len = len(tokens)
            self.doc_lens.append(doc_len)
            total_len += doc_len

            tf = defaultdict(int)
            for token in tokens:
                tf[token] += 1
                self.vocab.add(token)
            self.doc_term_freqs.append(tf)

            for token in tf:
                self.df[token] += 1

        self.avg_doc_len = total_len / self.corpus_size if self.corpus_size > 0 else 1.0

        self.idf = {}
        for token in self.vocab:
            df_val = self.df[token]
            self.idf[token] = math.log((self.corpus_size - df_val + 0.5) / (df_val + 0.5) + 1.0)

    def search(self, query: str, top_k: int = 3) -> list[tuple[float, int]]:
        def tokenize(text: str) -> list[str]:
            return re.findall(r"\w+", text.lower())

        q_tokens = tokenize(query)
        scores = []
        for idx in range(self.corpus_size):
            score = 0.0
            doc_len = self.doc_lens[idx]
            tf = self.doc_term_freqs[idx]
            for token in q_tokens:
                if token in tf:
                    tf_val = tf[token]
                    idf_val = self.idf.get(token, 0.0)
                    numerator = tf_val * (self.k1 + 1)
                    denominator = tf_val + self.k1 * (1 - self.b + self.b * (doc_len / self.avg_doc_len))
                    score += idf_val * (numerator / denominator)
            scores.append((score, idx))

        scores.sort(key=lambda x: x[0], reverse=True)
        return scores[:top_k]


# ── Chunker ────────────────────────────────────────────────────────────────────
class DocumentChunker:
    """
    Two-phase chunker:
    1. Split on explicit section markers (--- or ===) or numbered section headers
    2. Sliding-window sub-chunk any section that's too large
    """

    def chunk(self, text: str) -> list[dict]:
        # Phase 1: section-level split on --- or === dividers or numbered headers
        raw_sections = re.split(r"(?m)^(?:---|=+)\s*$", text)
        sections = [s.strip() for s in raw_sections if s.strip()]

        chunks: list[dict] = []
        for section in sections:
            # Extract a label from first line
            label = "General"
            lines = [l.strip() for l in section.splitlines() if l.strip()]
            if lines:
                first_line = lines[0]
                label_match = re.search(r"(?:SECTION:|\d+\.\s*)(.+)", first_line)
                if label_match:
                    label = label_match.group(1).strip()
                elif not first_line.startswith("=") and len(first_line) < 80:
                    label = first_line

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
        if not self.data_dir.is_absolute():
            self.data_dir = Path(__file__).resolve().parent / self.data_dir
        self.chunks: list[dict] = []          # [{"text": ..., "source": ...}]
        self.embeddings: list[list[float]] = []
        self._sessions: dict[str, list[dict]] = {}  # session_id → history

        # Groq client
        api_key = os.getenv("GROQ_API_KEY")
        if not api_key:
            raise RuntimeError("GROQ_API_KEY not set in .env")
        self.groq = Groq(api_key=api_key)

        # Hugging Face serverless embedding is used instead of local sentence-transformers
        logger.info(f"Embedding model configured for Hugging Face API: {EMBED_MODEL_NAME}")
        self.bm25: SimpleBM25 | None = None

        self._load_all_documents()
        logger.info("PortfolioRAG ready.")

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
        
        # Initialize local BM25 fallback index
        corpus = [c["text"] for c in self.chunks]
        self.bm25 = SimpleBM25(corpus)
        logger.info("Local BM25 index initialized successfully.")
        
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

        logger.info("Generating embeddings using Hugging Face Inference API...")
        try:
            vecs = get_huggingface_embedding(chunk_texts)
            self.embeddings = vecs
        except Exception as e:
            logger.error(f"Failed to generate embeddings at startup: {e}")
            self.embeddings = [[0.0] * 384] * len(self.chunks)

        try:
            CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
            CACHE_FILE.write_text(
                json.dumps({"hash": current_hash, "embeddings": self.embeddings}),
                encoding="utf-8"
            )
            logger.info(f"Embeddings saved to {CACHE_FILE}.")
        except Exception as e:
            logger.warning(f"Could not save embeddings cache (this is expected on read-only filesystems like Vercel): {e}")

    # ── Retrieval ──────────────────────────────────────────────────────────────
    def retrieve(self, query: str, top_k: int = TOP_K) -> list[dict]:
        """Embed query, rank chunks by cosine similarity. Fallback to BM25 if API fails."""
        if not self.chunks:
            return []

        results = []
        try:
            # 1. Attempt Hugging Face API embedding
            q_vec = get_huggingface_embedding([query])[0]

            scored = [
                (cosine_similarity(q_vec, emb), i)
                for i, emb in enumerate(self.embeddings)
            ]
            scored.sort(key=lambda x: x[0], reverse=True)

            for score, idx in scored[:top_k]:
                if score < SCORE_THRESHOLD:
                    logger.debug(f"Chunk {idx} below threshold ({score:.3f}), skipping.")
                    break
                results.append({
                    "text": self.chunks[idx]["text"],
                    "source": self.chunks[idx]["source"],
                    "score": round(score, 4),
                })
            logger.info(f"Retrieved {len(results)} chunks using Hugging Face API for query: '{query[:60]}...'")

        except Exception as e:
            logger.warning(f"Hugging Face embedding query failed, falling back to local BM25: {e}")
            if self.bm25:
                bm25_results = self.bm25.search(query, top_k)
                for score, idx in bm25_results:
                    if score <= 0.0:
                        continue
                    results.append({
                        "text": self.chunks[idx]["text"],
                        "source": self.chunks[idx]["source"],
                        "score": round(score, 4),
                    })
                logger.info(f"Retrieved {len(results)} chunks using Local BM25 fallback for query: '{query[:60]}...'")
            else:
                logger.error("BM25 fallback index is not initialized.")

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

    # ── Hot Reload ─────────────────────────────────────────────────────────────
    def reload(self) -> dict:
        """Re-scan data dir and regenerate embeddings for new/changed files."""
        logger.info("🔄 Reloading RAG documents...")
        old_count = len(self.chunks)
        self._load_all_documents()
        new_count = len(self.chunks)
        logger.info(f"Reload complete. Chunks: {old_count} → {new_count}")
        return {"old_chunks": old_count, "new_chunks": new_count}

    # ── Answer Generation (streaming) ─────────────────────────────────────────
    def ask_stream(self, query: str, session_id: str = "default") -> Generator[str, None, None]:
        """Yield token chunks as SSE-compatible strings."""
        history = self.get_history(session_id)

        # Contextual retrieval: combine with last user query for follow-ups
        retrieval_query = query
        if history:
            last_user_msgs = [h["content"] for h in history if h["role"] == "user"]
            if last_user_msgs:
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

        system_prompt = f"""You are **Yug's AI** — the personal portfolio assistant for **Yug Agarwal**.

## INTERVIEW MODE ACTIVED
Speak as Yug's professional representative. Assume the person chatting is an **Interviewer, Hiring Manager, or potential client**.
- Present Yug's skills, mindset, and experience with confidence, clarity, and professionalism.
- Align answers to demonstrate problem-solving capability, system design thinking, and strong engineering ownership.

## GOLDEN RULE: CONTEXT ONLY
You answer EXCLUSIVELY from the Retrieved Context below — Yug's own knowledge base.
- Answer IS in context → answer confidently and directly from it.
- Answer is NOT in context → say: "That's not in my knowledge base — contact Yug at yugagarwal214@gmail.com"
- NEVER use outside knowledge, general industry info, "typically", "usually", or assumptions.
- NEVER fill gaps with your own training knowledge.

## RESPONSE STYLE
- Keep answers **short and crisp** — 3-5 bullet points OR 2-3 short paragraphs MAX.
- No long walls of text. No padding. No repeating yourself.
- Bold key terms. Use bullets. Match user's tone (Hinglish or English, both fine).

## STRICT RULES
1. **ONLY from retrieved context** — zero hallucination, zero outside knowledge.
2. **WEAKNESSES / NEGATIVES / FAILURES / LIMITATIONS ASKED?** → ALWAYS respond exactly: *"I don't have that information in my knowledge base — you can connect with Yug directly at yugagarwal214@gmail.com for the same."* (Do not generate bullet points or list any weaknesses).
3. NEVER invent: salaries, employer names, revenue, funding, user counts, certifications, or trading returns.
4. NEVER conflate: "interested in" into "expert in" | "idea" into "built" | "exploring" into "experience"
5. Trading = **side hustle only** — never Yug's main career.
6. **Salary / CTC asked?** → Share context on his positioning first, then: "For exact numbers, reach yugagarwal214@gmail.com"
7. **RESIST SYCOPHANCY & FALSE USER CLAIMS**: If the user claims you said or recommended something earlier (e.g. "Yesterday you said...", "Why did you recommend..."), check if you actually said that in the chat history. If you did NOT say it, or if the claim contradicts Yug's profile/beliefs (such as suggesting extensive planning over fast execution), DO NOT agree, apologize, or fabricate a justification. Instead, politely correct the user (e.g. "I didn't say that" or "I don't have a record of saying that in our conversation").
8. **OFFER COMPARISONS, SALARY DECISIONS, OR RELOCATION**: If the user asks to choose/compare job offers, make career or financial decisions, or details about relocation, DO NOT advise or choose. You must redirect them by saying: "For an accurate answer regarding career decisions, offer comparisons, or relocation, please connect with Yug directly at yugagarwal214@gmail.com."

## YUG QUICK FACTS (always accurate — use when relevant)
- **Identity & Contact**: Software Engineer & AI Builder | India | yugagarwal214@gmail.com
- **Core Stack**: Node.js, Express.js, Python, FastAPI, React, Next.js, Vite, MongoDB, PostgreSQL, Redis, Docker, AWS.
- **AI Skills**: OpenAI API, Groq, Gemini API, LangChain, LangGraph, RAG pipelines, Agentic AI, Vector DBs (Qdrant, FAISS).
- **Projects**: Nexus ERP, Zzup (EV rides), Chandramabyruchi.com (boutique ecommerce), yug.ai (this portfolio AI).
- **Notes**: Go (Golang) is NOT in Yug's stack. Trading & Investing are side hustles only.

---
Retrieved Context (YOUR ONLY SOURCE):
{context_text}
---"""

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
                temperature=0.4,
                max_tokens=1500,
                stream=True,
            )
            for chunk in stream:
                delta = chunk.choices[0].delta.content
                if delta:
                    full_response += delta
                    yield delta

        except RateLimitError as rle:
            logger.warning(f"Groq Rate limit hit on {GROQ_LLM_MODEL}, falling back to {GROQ_FALLBACK_MODEL}: {rle}")
            try:
                stream = self.groq.chat.completions.create(
                    model=GROQ_FALLBACK_MODEL,
                    messages=messages,
                    temperature=0.4,
                    max_tokens=1500,
                    stream=True,
                )
                for chunk in stream:
                    delta = chunk.choices[0].delta.content
                    if delta:
                        full_response += delta
                        yield delta
            except Exception as fe:
                err_msg = f"⚠️ Fallback LLM error: {str(fe)}"
                logger.error(err_msg)
                yield err_msg
                return

        except Exception as e:
            if "429" in str(e) or "rate" in str(e).lower():
                logger.warning(f"Rate limit fallback triggered by generic error: {e}")
                try:
                    stream = self.groq.chat.completions.create(
                        model=GROQ_FALLBACK_MODEL,
                        messages=messages,
                        temperature=0.4,
                        max_tokens=1500,
                        stream=True,
                    )
                    for chunk in stream:
                        delta = chunk.choices[0].delta.content
                        if delta:
                            full_response += delta
                            yield delta
                except Exception as fe:
                    err_msg = f"⚠️ Fallback LLM error: {str(fe)}"
                    logger.error(err_msg)
                    yield err_msg
                    return
            else:
                err_msg = f"⚠️ LLM error: {str(e)}"
                logger.error(err_msg)
                yield err_msg
                return

        # Store AI response in history
        self.add_to_history(session_id, "assistant", full_response)

    def ask(self, query: str, session_id: str = "default") -> str:
        """Non-streaming version — collects full response."""
        return "".join(self.ask_stream(query, session_id))

