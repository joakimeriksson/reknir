"""Chat orchestration service — the core tool loop and SSE event generation."""

import base64
import json
from collections.abc import AsyncGenerator
from pathlib import Path

from sqlalchemy.orm import Session

from app.models.ai_assistant import AISettings, AIUpload, ChatMessage, ChatSession
from app.models.user import User
from app.services.ai_api_client import AIAPIClient
from app.services.ai_system_prompt import build_system_prompt
from app.services.ai_tools import (
    FORM_TOOLS,
    TOOL_DEFINITIONS,
    execute_tool,
    get_display_name,
    is_read_tool,
    is_write_tool,
)
from app.services.ollama_service import chat_generate, chat_stream

MAX_TOOL_ROUNDS = 5
AI_UPLOADS_DIR = Path("/app/uploads/ai_uploads")

IMAGE_EXTRACTION_PROMPT = """\
Analysera bifogade bilder noggrant och extrahera ALL synlig information. \
Svara ENBART med den extraherade informationen i punktform.

Inkludera (om synligt):
- Leverantör / företagsnamn
- Organisationsnummer
- Kontaktperson
- Adress (gatuadress, postnummer, stad)
- Telefonnummer
- E-postadress
- Fakturanummer
- Fakturadatum
- Förfallodatum
- Betalningsvillkor (antal dagar)
- Belopp exkl. moms
- Moms (belopp och procentsats)
- Totalbelopp inkl. moms
- Betalningsreferens / OCR-nummer
- Bankgiro / plusgiro / kontonummer (inklusive clearingnummer)
- IBAN
- BIC / SWIFT-kod
- Enskilda rader/poster: beskrivning, antal, enhetspris, momssats och radbelopp per rad
"""


def _sse_event(event: str, data: dict) -> dict:
    """Format an SSE event."""
    return {"event": event, "data": json.dumps(data, ensure_ascii=False)}


def _get_settings(db: Session) -> AISettings:
    settings = db.query(AISettings).filter(AISettings.id == 1).first()
    if not settings:
        raise RuntimeError("AI settings not found")
    return settings


def _build_ollama_messages(session: ChatSession, system_prompt: str) -> list[dict]:
    """Convert DB messages to Ollama message format."""
    messages = [{"role": "system", "content": system_prompt}]

    for msg in session.messages:
        if msg.role == "user":
            messages.append({"role": "user", "content": msg.content or ""})
        elif msg.role == "assistant":
            messages.append({"role": "assistant", "content": msg.content or ""})
        elif msg.role == "tool_call":
            # Represent as assistant message with tool_calls
            tool_call = {
                "function": {
                    "name": msg.tool_name,
                    "arguments": json.loads(msg.tool_args) if msg.tool_args else {},
                }
            }
            messages.append({"role": "assistant", "content": "", "tool_calls": [tool_call]})
        elif msg.role == "tool_result":
            messages.append({"role": "tool", "content": msg.content or ""})
        elif msg.role == "image_extraction":
            messages.append({"role": "user", "content": f"[Dokumentanalys av bifogad fil]\n{msg.content}"})

    return messages


def _load_as_base64_images(upload: AIUpload) -> list[str]:
    """Load an uploaded file and return base64-encoded images. PDFs are converted to images in memory."""
    file_path = AI_UPLOADS_DIR / upload.storage_filename
    if not file_path.exists():
        return []

    if upload.mime_type.startswith("image/"):
        return [base64.b64encode(file_path.read_bytes()).decode("utf-8")]

    if upload.mime_type == "application/pdf":
        try:
            import fitz  # pymupdf

            images = []
            with fitz.open(str(file_path)) as doc:
                for page in doc:
                    pix = page.get_pixmap(dpi=200)
                    images.append(base64.b64encode(pix.tobytes("jpeg")).decode("utf-8"))
            return images
        except Exception:
            return []

    return []


async def _extract_image_content(ollama_url: str, model: str, images: list[str]) -> str:
    """Run a dedicated vision pass to extract all visible information from images."""
    messages = [
        {"role": "user", "content": IMAGE_EXTRACTION_PROMPT, "images": images},
    ]
    return await chat_generate(ollama_url, model, messages)


def _add_images_to_last_user_message(messages: list[dict], images: list[str]) -> None:
    """Add base64 images to the last user message for vision models."""
    for i in range(len(messages) - 1, -1, -1):
        if messages[i]["role"] == "user":
            messages[i]["images"] = images
            break


def _remove_images_from_messages(messages: list[dict]) -> None:
    """Remove images from all messages to avoid resending them."""
    for msg in messages:
        msg.pop("images", None)


async def stream_chat_response(
    db: Session,
    user: User,
    company_id: int,
    session_id: int | None,
    content: str,
    attachment_ids: list[int] | None,
    token: str,
) -> AsyncGenerator[dict, None]:
    """Main chat endpoint — streams SSE events."""
    settings = _get_settings(db)

    # Get or create session
    if session_id:
        session = (
            db.query(ChatSession)
            .filter(
                ChatSession.id == session_id,
                ChatSession.user_id == user.id,
            )
            .first()
        )
        if not session:
            yield _sse_event("error", {"message": "Sessionen hittades inte."})
            return
    else:
        title = content[:100].strip()
        session = ChatSession(user_id=user.id, company_id=company_id, title=title)
        db.add(session)
        db.commit()
        db.refresh(session)

    # Block new messages if there's a pending tool approval
    pending = (
        db.query(ChatMessage)
        .filter(
            ChatMessage.session_id == session.id,
            ChatMessage.role == "tool_call",
            ChatMessage.tool_status == "pending",
        )
        .first()
    )
    if pending:
        yield _sse_event("error", {"message": "Det finns en väntande åtgärd som måste godkännas eller avvisas först."})
        return

    # Save user message
    user_msg = ChatMessage(
        session_id=session.id,
        role="user",
        content=content,
        attachment_ids=json.dumps(attachment_ids) if attachment_ids else None,
    )
    db.add(user_msg)
    db.commit()

    # Load images from attachments (PDFs are converted to images in memory)
    images = []
    if attachment_ids:
        for upload_id in attachment_ids:
            upload = db.query(AIUpload).filter(AIUpload.id == upload_id).first()
            if upload:
                images.extend(_load_as_base64_images(upload))

    # Pre-extract image content before the main chat flow
    if images:
        yield _sse_event("image_extracting", {})
        try:
            extraction_text = await _extract_image_content(settings.ollama_url, settings.ollama_model, images)
            if extraction_text.strip():
                extraction_msg = ChatMessage(
                    session_id=session.id,
                    role="image_extraction",
                    content=extraction_text.strip(),
                )
                db.add(extraction_msg)
                db.commit()
                yield _sse_event("image_extracted", {"content": extraction_text.strip()})
        except Exception:
            pass

    # Determine fiscal year (use latest for the company)
    from app.models.fiscal_year import FiscalYear

    fiscal_year = (
        db.query(FiscalYear).filter(FiscalYear.company_id == company_id).order_by(FiscalYear.year.desc()).first()
    )
    fiscal_year_id = fiscal_year.id if fiscal_year else None

    # Build system prompt
    system_prompt = build_system_prompt(settings.system_prompt)

    # Build message history (includes extraction if saved above)
    db.refresh(session)
    ollama_messages = _build_ollama_messages(session, system_prompt)

    # Add images to the last user message (still sent once for visual context)
    if images:
        _add_images_to_last_user_message(ollama_messages, images)

    # Create API client for tool execution
    api_client = AIAPIClient(base_url="http://localhost:8000", token=token)

    # Tool loop
    images_attached = bool(images)

    async for event in _tool_loop(
        db=db,
        session=session,
        settings=settings,
        ollama_messages=ollama_messages,
        api_client=api_client,
        company_id=company_id,
        fiscal_year_id=fiscal_year_id,
        images_attached=images_attached,
    ):
        yield event

    # Yield session info at the end
    yield _sse_event("done", {"session_id": session.id, "title": session.title})


async def _tool_loop(
    db: Session,
    session: ChatSession,
    settings: AISettings,
    ollama_messages: list[dict],
    api_client: AIAPIClient,
    company_id: int,
    fiscal_year_id: int | None,
    images_attached: bool,
    start_round: int = 0,
) -> AsyncGenerator[dict, None]:
    """Execute the tool loop (max MAX_TOOL_ROUNDS rounds)."""

    for round_num in range(start_round, MAX_TOOL_ROUNDS):
        is_last_round = round_num == MAX_TOOL_ROUNDS - 1

        # On last round, don't send tools to force a text response
        tools = None if is_last_round else TOOL_DEFINITIONS

        # Collect the full response from Ollama
        full_content = ""
        tool_calls = []

        async for chunk in chat_stream(settings.ollama_url, settings.ollama_model, ollama_messages, tools):
            # Check for tool calls
            if chunk.get("message", {}).get("tool_calls"):
                tool_calls = chunk["message"]["tool_calls"]

            # Stream text tokens
            token_text = chunk.get("message", {}).get("content", "")
            if token_text:
                full_content += token_text
                yield _sse_event("token", {"content": token_text})

        # If we got tool calls
        if tool_calls and not is_last_round:
            for tc in tool_calls:
                fn = tc.get("function", {})
                tool_name = fn.get("name", "")
                tool_args = fn.get("arguments", {})
                if isinstance(tool_args, str):
                    try:
                        tool_args = json.loads(tool_args)
                    except json.JSONDecodeError:
                        tool_args = {}

                if is_read_tool(tool_name):
                    # Execute read tool directly
                    yield _sse_event(
                        "tool_executing",
                        {
                            "tool_name": tool_name,
                            "display_name": get_display_name(tool_name),
                        },
                    )

                    result = await execute_tool(api_client, tool_name, tool_args, company_id, fiscal_year_id)
                    result_str = json.dumps(result, ensure_ascii=False, default=str)

                    # Save tool_call and tool_result messages
                    tc_msg = ChatMessage(
                        session_id=session.id,
                        role="tool_call",
                        tool_name=tool_name,
                        tool_args=json.dumps(tool_args, ensure_ascii=False),
                        tool_status="executed",
                    )
                    tr_msg = ChatMessage(
                        session_id=session.id,
                        role="tool_result",
                        tool_name=tool_name,
                        content=result_str,
                    )
                    db.add(tc_msg)
                    db.add(tr_msg)
                    db.commit()

                    yield _sse_event(
                        "tool_result",
                        {
                            "tool_name": tool_name,
                            "display_name": get_display_name(tool_name),
                            "result": result,
                        },
                    )

                    # Add to ollama messages for next round
                    ollama_messages.append(
                        {
                            "role": "assistant",
                            "content": "",
                            "tool_calls": [tc],
                        }
                    )
                    ollama_messages.append(
                        {
                            "role": "tool",
                            "content": result_str,
                        }
                    )

                elif is_write_tool(tool_name):
                    # Save proposal and wait for approval
                    tc_msg = ChatMessage(
                        session_id=session.id,
                        role="tool_call",
                        tool_name=tool_name,
                        tool_args=json.dumps(tool_args, ensure_ascii=False),
                        tool_status="executed" if tool_name in FORM_TOOLS else "pending",
                    )
                    db.add(tc_msg)
                    db.commit()
                    db.refresh(tc_msg)

                    ai_upload_ids = []
                    for msg in reversed(session.messages):
                        if msg.role == "user" and msg.attachment_ids:
                            try:
                                ai_upload_ids = json.loads(msg.attachment_ids)
                            except (json.JSONDecodeError, TypeError):
                                pass
                            break

                    yield _sse_event(
                        "tool_proposal",
                        {
                            "message_id": tc_msg.id,
                            "tool_name": tool_name,
                            "display_name": get_display_name(tool_name),
                            "tool_args": tool_args,
                            "round": round_num,
                            "ai_upload_ids": ai_upload_ids,
                        },
                    )
                    # Stop the loop — wait for approval
                    return

            # Continue to next round (read tools were executed)
            continue

        # Text response (no tool calls, or last round)
        if full_content:
            assistant_msg = ChatMessage(
                session_id=session.id,
                role="assistant",
                content=full_content,
            )
            db.add(assistant_msg)
            db.commit()

            # Remove images from history after text response
            if images_attached:
                _remove_images_from_messages(ollama_messages)

        return


async def approve_tool(
    db: Session,
    user: User,
    session_id: int,
    message_id: int,
    approved: bool,
    updated_args: dict | None,
    token: str,
) -> AsyncGenerator[dict, None]:
    """Handle tool approval/denial and continue the tool loop if approved."""
    settings = _get_settings(db)

    session = (
        db.query(ChatSession)
        .filter(
            ChatSession.id == session_id,
            ChatSession.user_id == user.id,
        )
        .first()
    )
    if not session:
        yield _sse_event("error", {"message": "Sessionen hittades inte."})
        return

    tc_msg = (
        db.query(ChatMessage)
        .filter(
            ChatMessage.id == message_id,
            ChatMessage.session_id == session_id,
            ChatMessage.role == "tool_call",
            ChatMessage.tool_status == "pending",
        )
        .first()
    )
    if not tc_msg:
        yield _sse_event("error", {"message": "Verktygsförslaget hittades inte."})
        return

    if not approved:
        tc_msg.tool_status = "denied"
        denied_msg = ChatMessage(
            session_id=session.id,
            role="assistant",
            content="Åtgärden avbröts av användaren.",
        )
        db.add(denied_msg)
        db.commit()

        yield _sse_event("tool_status", {"status": "denied", "message_id": message_id})
        yield _sse_event("token", {"content": "Åtgärden avbröts."})
        yield _sse_event("done", {"session_id": session.id, "title": session.title})
        return

    # Merge updated args
    tool_args = json.loads(tc_msg.tool_args) if tc_msg.tool_args else {}
    if updated_args:
        tool_args.update(updated_args)
        tc_msg.tool_args = json.dumps(tool_args, ensure_ascii=False)

    # Execute the tool
    api_client = AIAPIClient(base_url="http://localhost:8000", token=token)
    company_id = session.company_id

    from app.models.fiscal_year import FiscalYear

    fiscal_year = (
        db.query(FiscalYear).filter(FiscalYear.company_id == company_id).order_by(FiscalYear.year.desc()).first()
    )
    fiscal_year_id = fiscal_year.id if fiscal_year else None

    result = await execute_tool(api_client, tc_msg.tool_name, tool_args, company_id, fiscal_year_id)
    result_str = json.dumps(result, ensure_ascii=False, default=str)

    tc_msg.tool_status = "executed" if result.get("success") else "error"
    tr_msg = ChatMessage(
        session_id=session.id,
        role="tool_result",
        tool_name=tc_msg.tool_name,
        content=result_str,
    )
    db.add(tr_msg)
    db.commit()

    yield _sse_event(
        "tool_status",
        {
            "status": tc_msg.tool_status,
            "message_id": message_id,
            "result": result,
        },
    )

    # Build message history and continue the tool loop
    system_prompt = build_system_prompt(settings.system_prompt)
    db.refresh(session)
    ollama_messages = _build_ollama_messages(session, system_prompt)

    # Resume from next round (we don't track round in DB, so count tool_call messages)
    tool_call_count = (
        db.query(ChatMessage).filter(ChatMessage.session_id == session_id, ChatMessage.role == "tool_call").count()
    )
    resume_round = min(tool_call_count, MAX_TOOL_ROUNDS - 1)

    async for event in _tool_loop(
        db=db,
        session=session,
        settings=settings,
        ollama_messages=ollama_messages,
        api_client=api_client,
        company_id=company_id,
        fiscal_year_id=fiscal_year_id,
        images_attached=False,
        start_round=resume_round,
    ):
        yield event

    yield _sse_event("done", {"session_id": session.id, "title": session.title})
