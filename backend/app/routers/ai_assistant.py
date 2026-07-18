"""AI assistant router — chat, settings, sessions, and file uploads."""

import shutil
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import func
from sqlalchemy.orm import Session
from sse_starlette.sse import EventSourceResponse

from app.database import get_db
from app.dependencies import get_current_active_user, oauth2_scheme, require_admin
from app.models.ai_assistant import AISettings, AIUpload, ChatMessage, ChatSession
from app.models.attachment import Attachment, AttachmentStatus
from app.models.user import User
from app.schemas.ai_assistant import (
    AISettingsResponse,
    AISettingsUpdate,
    AIUploadResponse,
    ChatMessageRequest,
    ChatSessionListItem,
    ChatSessionResponse,
    OllamaHealthResponse,
    OllamaModelInfo,
    ToolApprovalRequest,
)
from app.schemas.attachment import AttachmentResponse
from app.services import ai_chat_service, ollama_service

router = APIRouter()

AI_UPLOADS_DIR = Path("/app/uploads/ai_uploads")
ALLOWED_MIME_TYPES = {"application/pdf", "image/jpeg", "image/png", "image/gif"}
MAX_FILE_SIZE = 30 * 1024 * 1024  # 30 MB


def _get_settings(db: Session) -> AISettings:
    settings = db.query(AISettings).filter(AISettings.id == 1).first()
    if not settings:
        raise HTTPException(status_code=500, detail="AI settings not configured")
    return settings


def _require_ai_enabled(db: Session) -> AISettings:
    settings = _get_settings(db)
    if not settings.ai_enabled:
        raise HTTPException(status_code=503, detail="AI assistant is disabled")
    return settings


# --- Health & Settings ---


@router.get("/health", response_model=OllamaHealthResponse)
async def health_check(
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    settings = _get_settings(db)
    health = await ollama_service.check_health(settings.ollama_url)

    result = OllamaHealthResponse(reachable=health["reachable"], error=health.get("error"))

    if health["reachable"] and settings.ollama_model:
        test = await ollama_service.test_model(settings.ollama_url, settings.ollama_model)
        result.model_available = test["success"]
        result.model_name = settings.ollama_model
        if not test["success"]:
            result.error = test.get("error")

    return result


@router.get("/settings", response_model=AISettingsResponse)
async def get_settings(
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    return _get_settings(db)


@router.put("/settings", response_model=AISettingsResponse)
async def update_settings(
    data: AISettingsUpdate,
    current_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    settings = _get_settings(db)
    update_data = data.model_dump(exclude_unset=True)

    for key, value in update_data.items():
        setattr(settings, key, value)
    settings.updated_by = current_user.id

    db.commit()
    db.refresh(settings)
    return settings


@router.get("/models", response_model=list[OllamaModelInfo])
async def list_models(
    current_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    settings = _get_settings(db)
    try:
        models = await ollama_service.list_models(settings.ollama_url)
        return [OllamaModelInfo(**m) for m in models]
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Could not reach Ollama: {e}") from e


# --- Chat ---


@router.post("/chat")
async def chat(
    request: ChatMessageRequest,
    current_user: User = Depends(get_current_active_user),
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
):
    _require_ai_enabled(db)

    async def event_generator():
        async for event in ai_chat_service.stream_chat_response(
            db=db,
            user=current_user,
            company_id=request.company_id,
            session_id=request.session_id,
            content=request.content,
            attachment_ids=request.attachment_ids,
            token=token,
        ):
            yield event

    return EventSourceResponse(event_generator())


@router.post("/chat/approve")
async def approve_tool(
    request: ToolApprovalRequest,
    current_user: User = Depends(get_current_active_user),
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
):
    _require_ai_enabled(db)

    async def event_generator():
        async for event in ai_chat_service.approve_tool(
            db=db,
            user=current_user,
            session_id=request.session_id,
            message_id=request.message_id,
            approved=request.approved,
            updated_args=request.updated_args,
            token=token,
        ):
            yield event

    return EventSourceResponse(event_generator())


# --- File Uploads ---


@router.post("/chat/upload", response_model=AIUploadResponse)
async def upload_file(
    company_id: int = Query(...),
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    _require_ai_enabled(db)

    if file.content_type not in ALLOWED_MIME_TYPES:
        raise HTTPException(status_code=400, detail=f"File type not allowed: {file.content_type}")

    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="File too large (max 30 MB)")

    AI_UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

    ext = Path(file.filename).suffix if file.filename else ""
    storage_filename = f"{uuid.uuid4()}{ext}"
    file_path = AI_UPLOADS_DIR / storage_filename
    file_path.write_bytes(content)

    upload = AIUpload(
        company_id=company_id,
        original_filename=file.filename or "unknown",
        storage_filename=storage_filename,
        mime_type=file.content_type or "application/octet-stream",
        size_bytes=len(content),
        created_by=current_user.id,
    )
    db.add(upload)
    db.commit()
    db.refresh(upload)
    return upload


@router.get("/uploads/{upload_id}")
async def get_upload(
    upload_id: int,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    upload = db.query(AIUpload).filter(AIUpload.id == upload_id).first()
    if not upload:
        raise HTTPException(status_code=404, detail="Upload not found")

    file_path = AI_UPLOADS_DIR / upload.storage_filename
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found on disk")

    return FileResponse(
        path=str(file_path),
        media_type=upload.mime_type,
        filename=upload.original_filename,
    )


@router.post("/uploads/{upload_id}/to-attachment", response_model=AttachmentResponse)
async def copy_upload_to_attachment(
    upload_id: int,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Copy an AI upload to a real bookkeeping attachment (server-side file copy)."""
    from app.services.attachment_service import ATTACHMENTS_DIR

    upload = db.query(AIUpload).filter(AIUpload.id == upload_id).first()
    if not upload:
        raise HTTPException(status_code=404, detail="Upload not found")

    src_path = AI_UPLOADS_DIR / upload.storage_filename
    if not src_path.exists():
        raise HTTPException(status_code=404, detail="Source file not found")

    ext = Path(upload.original_filename).suffix
    new_storage_filename = f"{uuid.uuid4()}{ext}"
    dst_path = ATTACHMENTS_DIR / new_storage_filename
    ATTACHMENTS_DIR.mkdir(parents=True, exist_ok=True)
    shutil.copy2(str(src_path), str(dst_path))

    attachment = Attachment(
        company_id=upload.company_id,
        original_filename=upload.original_filename,
        storage_filename=new_storage_filename,
        mime_type=upload.mime_type,
        size_bytes=upload.size_bytes,
        status=AttachmentStatus.UPLOADED,
        created_by=current_user.id,
    )
    db.add(attachment)
    db.commit()
    db.refresh(attachment)
    return attachment


# --- Sessions ---


@router.get("/sessions", response_model=list[ChatSessionListItem])
async def list_sessions(
    company_id: int = Query(...),
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    sessions = (
        db.query(
            ChatSession,
            func.count(ChatMessage.id).label("message_count"),
        )
        .outerjoin(ChatMessage, ChatMessage.session_id == ChatSession.id)
        .filter(
            ChatSession.user_id == current_user.id,
            ChatSession.company_id == company_id,
        )
        .group_by(ChatSession.id)
        .order_by(ChatSession.updated_at.desc())
        .all()
    )

    return [
        ChatSessionListItem(
            id=s.id,
            title=s.title,
            message_count=count,
            created_at=s.created_at,
            updated_at=s.updated_at,
        )
        for s, count in sessions
    ]


@router.get("/sessions/{session_id}", response_model=ChatSessionResponse)
async def get_session(
    session_id: int,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    session = (
        db.query(ChatSession)
        .filter(
            ChatSession.id == session_id,
            ChatSession.user_id == current_user.id,
        )
        .first()
    )
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@router.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_session(
    session_id: int,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    session = (
        db.query(ChatSession)
        .filter(
            ChatSession.id == session_id,
            ChatSession.user_id == current_user.id,
        )
        .first()
    )
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    db.delete(session)
    db.commit()
