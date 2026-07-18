from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import relationship

from app.database import Base


class AISettings(Base):
    """Single-row table for AI assistant configuration."""

    __tablename__ = "ai_settings"

    id = Column(Integer, primary_key=True)
    ai_enabled = Column(Boolean, default=False, nullable=False)
    ollama_url = Column(String(500), default="http://host.docker.internal:11434", nullable=False)
    ollama_model = Column(String(200), default="llama3.1:8b", nullable=False)
    system_prompt = Column(Text, nullable=True)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)
    updated_by = Column(Integer, ForeignKey("users.id"), nullable=True)

    def __repr__(self):
        return f"<AISettings enabled={self.ai_enabled} model={self.ollama_model}>"


class ChatSession(Base):
    """A chat conversation between a user and the AI assistant."""

    __tablename__ = "chat_sessions"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False)
    title = Column(String(100), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    messages = relationship(
        "ChatMessage", back_populates="session", cascade="all, delete-orphan", order_by="ChatMessage.id"
    )
    user = relationship("User", foreign_keys=[user_id])
    company = relationship("Company", foreign_keys=[company_id])

    __table_args__ = (Index("ix_chat_sessions_user_company", "user_id", "company_id"),)

    def __repr__(self):
        return f"<ChatSession id={self.id} title={self.title!r}>"


class ChatMessage(Base):
    """A single message in a chat session."""

    __tablename__ = "chat_messages"

    id = Column(Integer, primary_key=True)
    session_id = Column(Integer, ForeignKey("chat_sessions.id", ondelete="CASCADE"), nullable=False, index=True)
    role = Column(String(20), nullable=False)  # user, assistant, tool_call, tool_result
    content = Column(Text, nullable=True)
    tool_name = Column(String(100), nullable=True)
    tool_args = Column(Text, nullable=True)  # JSON string
    tool_status = Column(String(20), nullable=True)  # pending, approved, denied, executed, error
    attachment_ids = Column(Text, nullable=True)  # JSON array of ai_uploads IDs
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)

    session = relationship("ChatSession", back_populates="messages")

    def __repr__(self):
        return f"<ChatMessage id={self.id} role={self.role}>"


class AIUpload(Base):
    """Temporary file uploaded in the AI chat, separate from bookkeeping attachments."""

    __tablename__ = "ai_uploads"

    id = Column(Integer, primary_key=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False)
    original_filename = Column(String(500), nullable=False)
    storage_filename = Column(String(500), nullable=False, unique=True)
    mime_type = Column(String(100), nullable=False)
    size_bytes = Column(Integer, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)

    def __repr__(self):
        return f"<AIUpload id={self.id} filename={self.original_filename!r}>"
