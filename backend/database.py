"""
yug.ai — MongoDB Database Layer
Handles all chat session & message persistence.
Collections:
  - chat_sessions : { _id, title, created_at, updated_at }
  - chat_messages : { _id, session_id, role, text, timestamp }
"""

import os
import logging
from datetime import datetime, timezone
from typing import Optional
from pymongo import MongoClient, DESCENDING
from pymongo.collection import Collection
from bson import ObjectId
from dotenv import load_dotenv

load_dotenv()
logger = logging.getLogger(__name__)

# ── Connection ─────────────────────────────────────────────────────────────────
MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017")
DB_NAME   = os.getenv("MONGO_DB_NAME", "yug_ai")

_client: Optional[MongoClient] = None

def get_db():
    global _client
    if _client is None:
        _client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
        logger.info(f"MongoDB connected → {MONGO_URI} / {DB_NAME}")
    return _client[DB_NAME]


def get_sessions_col() -> Collection:
    return get_db()["chat_sessions"]


def get_messages_col() -> Collection:
    return get_db()["chat_messages"]


# ── Ensure indexes ─────────────────────────────────────────────────────────────
def init_indexes():
    try:
        get_messages_col().create_index("session_id")
        get_messages_col().create_index("timestamp")
        get_sessions_col().create_index([("updated_at", DESCENDING)])
        logger.info("MongoDB indexes ensured.")
    except Exception as e:
        logger.warning(f"Could not create indexes: {e}")


# ── Internal query helper ──────────────────────────────────────────────────────
def _session_query(session_id: str) -> dict:
    if ObjectId.is_valid(session_id):
        return {"$or": [{"_id": ObjectId(session_id)}, {"_id": session_id}]}
    return {"_id": session_id}


# ── Session CRUD ───────────────────────────────────────────────────────────────
def create_session(session_id: Optional[str] = None, title: str = "New Chat") -> dict:
    now = datetime.now(timezone.utc)
    doc = {
        "title": title,
        "created_at": now,
        "updated_at": now,
    }
    if session_id:
        if ObjectId.is_valid(session_id):
            doc["_id"] = ObjectId(session_id)
        else:
            doc["_id"] = session_id

    result = get_sessions_col().insert_one(doc)
    doc["_id"] = str(result.inserted_id)
    doc["created_at"] = now.isoformat()
    doc["updated_at"] = now.isoformat()
    return doc


def list_sessions() -> list[dict]:
    sessions = get_sessions_col().find(
        {}, {"_id": 1, "title": 1, "created_at": 1, "updated_at": 1}
    ).sort("updated_at", DESCENDING)
    return [_serialize(s) for s in sessions]


def get_session(session_id: str) -> Optional[dict]:
    try:
        doc = get_sessions_col().find_one(_session_query(session_id))
        return _serialize(doc) if doc else None
    except Exception:
        return None


def update_session_title(session_id: str, title: str):
    try:
        get_sessions_col().update_one(
            _session_query(session_id),
            {"$set": {"title": title, "updated_at": datetime.now(timezone.utc)}}
        )
    except Exception as e:
        logger.warning(f"Could not update session title: {e}")


def touch_session(session_id: str, default_title: str = "New Chat"):
    """Update updated_at timestamp. Auto-create session if not present."""
    try:
        res = get_sessions_col().update_one(
            _session_query(session_id),
            {"$set": {"updated_at": datetime.now(timezone.utc)}}
        )
        if res.matched_count == 0:
            create_session(session_id=session_id, title=default_title)
    except Exception as e:
        logger.warning(f"Could not touch session: {e}")


def delete_session(session_id: str):
    try:
        get_sessions_col().delete_one(_session_query(session_id))
        get_messages_col().delete_many({"session_id": session_id})
        logger.info(f"Deleted session {session_id} and its messages.")
    except Exception as e:
        logger.warning(f"Could not delete session: {e}")


# ── Message CRUD ───────────────────────────────────────────────────────────────
def save_message(session_id: str, role: str, text: str) -> dict:
    now = datetime.now(timezone.utc)
    doc = {
        "session_id": session_id,
        "role": role,          # "user" | "assistant"
        "text": text,
        "timestamp": now,
    }
    result = get_messages_col().insert_one(doc)
    doc["_id"] = str(result.inserted_id)
    doc["timestamp"] = now.isoformat()
    # Touch the parent session so it floats to top
    touch_session(session_id)
    return doc


def get_messages(session_id: str) -> list[dict]:
    msgs = get_messages_col().find(
        {"session_id": session_id},
        {"_id": 1, "role": 1, "text": 1, "timestamp": 1}
    ).sort("timestamp", 1)
    return [_serialize(m) for m in msgs]


# ── Internal helper ────────────────────────────────────────────────────────────
def _serialize(doc: dict) -> dict:
    """Convert ObjectId and datetime to JSON-safe types."""
    out = {}
    for k, v in doc.items():
        if isinstance(v, ObjectId):
            out[k] = str(v)
        elif isinstance(v, datetime):
            out[k] = v.isoformat()
        else:
            out[k] = v
    return out

