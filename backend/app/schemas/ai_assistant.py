from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

# --- AI Settings ---


class AISettingsResponse(BaseModel):
    ai_enabled: bool
    ollama_url: str
    ollama_model: str
    system_prompt: str | None = None
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AISettingsUpdate(BaseModel):
    ai_enabled: bool | None = None
    ollama_url: str | None = None
    ollama_model: str | None = None
    system_prompt: str | None = None


# --- Ollama ---


class OllamaModelInfo(BaseModel):
    name: str
    size: int | None = None
    parameter_size: str | None = None
    quantization_level: str | None = None
    modified_at: str | None = None


class OllamaHealthResponse(BaseModel):
    reachable: bool
    model_available: bool | None = None
    model_name: str | None = None
    error: str | None = None


# --- Chat Sessions ---


class ChatSessionListItem(BaseModel):
    id: int
    title: str
    message_count: int = 0
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ChatMessageResponse(BaseModel):
    id: int
    session_id: int
    role: str
    content: str | None = None
    tool_name: str | None = None
    tool_args: str | None = None
    tool_status: str | None = None
    attachment_ids: str | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ChatSessionResponse(BaseModel):
    id: int
    title: str
    created_at: datetime
    updated_at: datetime
    messages: list[ChatMessageResponse] = []

    model_config = ConfigDict(from_attributes=True)


# --- Chat Requests ---


class ChatMessageRequest(BaseModel):
    content: str = Field(..., min_length=1)
    session_id: int | None = None
    company_id: int
    attachment_ids: list[int] | None = None


class ToolApprovalRequest(BaseModel):
    session_id: int
    message_id: int
    approved: bool
    updated_args: dict | None = None


# --- AI Uploads ---


class AIUploadResponse(BaseModel):
    id: int
    original_filename: str
    mime_type: str
    size_bytes: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
