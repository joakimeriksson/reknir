# AI Assistant — Technical Reference

This document describes the complete implementation of the AI chat assistant feature. It serves as a reference for maintenance and, if needed, full removal of the feature.

## Architecture Overview

The AI assistant runs via Ollama (a locally hosted LLM). It communicates with the application's own REST API using the logged-in user's JWT token, ensuring all authorization checks apply. No data leaves the server.

```
User → ChatPanel (React) → POST /api/ai/chat (SSE stream)
                              ↓
                         ai_chat_service.py (tool loop, max 5 rounds)
                              ↓
                    ┌─────────┴──────────┐
                    ↓                    ↓
              Ollama (LLM)       ai_api_client.py
              via httpx          (calls own REST API
              streaming          with user's JWT)
```

Write tools (create_invoice, etc.) open the real application form with pre-populated fields via `AIFormContext`, instead of executing through the API.

---

## Files Created

### Backend

| File | Purpose |
|------|---------|
| `backend/alembic/versions/20260414_1200-027_add_ai_assistant_tables.py` | Migration: creates 4 tables |
| `backend/app/models/ai_assistant.py` | SQLAlchemy models: `AISettings`, `ChatSession`, `ChatMessage`, `AIUpload` |
| `backend/app/schemas/ai_assistant.py` | Pydantic request/response schemas |
| `backend/app/routers/ai_assistant.py` | API endpoints under `/api/ai/` |
| `backend/app/services/ollama_service.py` | HTTP client for Ollama (health, models, chat streaming) |
| `backend/app/services/ai_api_client.py` | HTTP client that calls our own REST API with user's JWT |
| `backend/app/services/ai_tools.py` | Tool definitions (OpenAI function-calling format) and dispatch |
| `backend/app/services/ai_chat_service.py` | Core orchestration: tool loop, SSE events, image/PDF handling |
| `backend/app/services/ai_system_prompt.py` | Swedish system prompt with bookkeeping rules |

### Frontend

| File | Purpose |
|------|---------|
| `frontend/src/contexts/AIFormContext.tsx` | React context bridging chat panel and page-level form modals |
| `frontend/src/hooks/useAIChat.ts` | Hook for SSE parsing, message state, session management |
| `frontend/src/components/ai/ChatFAB.tsx` | Floating action button (bottom-right, hidden when AI disabled) |
| `frontend/src/components/ai/ChatPanel.tsx` | Sliding side panel with sessions, messages, input, file upload |
| `frontend/src/components/ai/ChatMessage.tsx` | Message rendering (markdown, tool steps, proposals) |
| `frontend/src/components/ai/ToolProposalCard.tsx` | Editable approval card for non-form write tools |

---

## Files Modified

### Backend

| File | What was added |
|------|----------------|
| `backend/app/main.py` | Import `ai_assistant` router, register with `prefix="/api/ai"` |
| `backend/app/models/__init__.py` | Import and export `AISettings`, `AIUpload`, `ChatMessage`, `ChatSession` |
| `backend/requirements.txt` | Added `sse-starlette==1.8.2` and `pymupdf==1.25.3` |

### Frontend

| File | What was added |
|------|----------------|
| `frontend/src/App.tsx` | Import ChatFAB, ChatPanel, AIFormProvider. State for `isChatOpen`, `aiEnabled`. Render ChatFAB + ChatPanel. Wrap routes with `AIFormProvider`. |
| `frontend/src/services/api.ts` | `aiApi` object with methods for health, settings, models, sessions, upload |
| `frontend/src/types/index.ts` | Interfaces: `AISettings`, `AISettingsUpdate`, `OllamaModel`, `OllamaHealth`, `ChatSession`, `ChatMessage`, `ChatSessionDetail`, `ToolProposal`, `AIUpload` |
| `frontend/src/pages/Settings.tsx` | AI tab (`activeTab === 'ai'`): toggle, Ollama URL, model selector, system prompt, test button. Imports: `aiApi`, `useAuth`, `useAIForm`, AI types, `Bot` icon. State: `aiSettings`, `aiModels`, `aiHealth`, `aiForm`, `aiLoading`, `aiSaving`, `aiTesting`. Functions: `loadAiSettings`, `testAiConnection`, `saveAiSettings`. |
| `frontend/src/pages/Invoices.tsx` | Import `useAIForm`. State: `invoiceInitialData`, `supplierInvoiceInitialData`. Effect watching `pendingForm` to open modals. Pass `initialData` to InvoiceForm and SupplierInvoiceForm. |
| `frontend/src/pages/Verifications.tsx` | Import `useAIForm`, `VerificationInitialData`. State: `verificationInitialData`. Effect watching `pendingForm`. Pass `initialData` to VerificationForm. |
| `frontend/src/pages/Expenses.tsx` | Import `useAIForm`. Effect watching `pendingForm` to pre-fill expense form. |
| `frontend/src/pages/Customers.tsx` | Import `useAIForm`. Effect watching `pendingForm` to open customer/supplier modals with pre-filled data. |
| `frontend/src/components/forms/InvoiceForm.tsx` | Added `InvoiceInitialData` interface and `initialData?` prop. State initializers use `initialData` values. |
| `frontend/src/components/forms/SupplierInvoiceForm.tsx` | Added `SupplierInvoiceInitialData` interface and `initialData?` prop. State initializers use `initialData` values. |
| `frontend/src/components/forms/VerificationForm.tsx` | Added `VerificationInitialData` interface and `initialData?` prop. State initializers use `initialData` values. |
| `frontend/src/index.css` | `.ai-markdown` class: styles for p, ul, ol, li, h1-h4, strong, code, pre elements |
| `frontend/package.json` | Added `react-markdown: ^9.0.1` |

### Documentation

| File | What was added |
|------|----------------|
| `README.md` | "AI bookkeeping assistant powered by Ollama" in features list. `ai/` directory in project structure. |
| `docs/CLAUDE.md` | Section 13 "AI-assistent". AI tables in database schema. v1.3.4 changelog entry. |
| `docs/ROADMAP.md` | Section 2.3: AI assistant marked as done (v1.3.4). |

---

## Database Tables

All created in migration `027`. Downgrade drops all four tables.

### ai_settings (singleton, id=1)
| Column | Type | Default |
|--------|------|---------|
| id | Integer PK | |
| ai_enabled | Boolean | false |
| ollama_url | String(500) | `http://host.docker.internal:11434` |
| ollama_model | String(200) | `llama3.1:8b` |
| system_prompt | Text | null |
| updated_at | DateTime | now() |
| updated_by | Integer FK→users.id | null |

### chat_sessions
| Column | Type |
|--------|------|
| id | Integer PK |
| user_id | Integer FK→users.id |
| company_id | Integer FK→companies.id |
| title | String(100) |
| created_at, updated_at | DateTime |

Index: `ix_chat_sessions_user_company` on (user_id, company_id)

### chat_messages
| Column | Type |
|--------|------|
| id | Integer PK |
| session_id | Integer FK→chat_sessions.id ON DELETE CASCADE |
| role | String(20): user, assistant, tool_call, tool_result |
| content | Text nullable |
| tool_name | String(100) nullable |
| tool_args | Text nullable (JSON) |
| tool_status | String(20) nullable: pending, approved, denied, executed, error |
| attachment_ids | Text nullable (JSON array) |
| created_at | DateTime |

Index: `ix_chat_messages_session_id`

### ai_uploads
| Column | Type |
|--------|------|
| id | Integer PK |
| company_id | Integer FK→companies.id |
| original_filename | String(500) |
| storage_filename | String(500) unique |
| mime_type | String(100) |
| size_bytes | Integer |
| created_at | DateTime |
| created_by | Integer FK→users.id |

Files stored at: `/app/uploads/ai_uploads/`

---

## API Endpoints

All under prefix `/api/ai`, tag `ai-assistant`.

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | /health | user | Check Ollama status + model test |
| GET | /settings | user | Get AI configuration |
| PUT | /settings | admin | Update AI configuration |
| GET | /models | admin | List Ollama models |
| POST | /chat | user | Send message, SSE stream response |
| POST | /chat/approve | user | Approve/deny write tool proposal |
| POST | /chat/upload | user | Upload file for AI analysis |
| GET | /uploads/{id} | user | Serve uploaded file |
| GET | /sessions | user | List sessions for user+company |
| GET | /sessions/{id} | user | Get session with all messages |
| DELETE | /sessions/{id} | user | Delete session (cascade) |

---

## Dependencies Added

### Python (backend)
- `sse-starlette==1.8.2` — SSE streaming for chat responses
- `pymupdf==1.25.3` — PDF to image conversion for vision models

### JavaScript (frontend)
- `react-markdown@^9.0.1` — Markdown rendering in chat messages

---

## Removal Instructions

To completely remove the AI assistant feature:

### Step 1: Database
```bash
docker compose exec backend alembic downgrade 026
```
This drops all four AI tables and the uploaded files directory.

### Step 2: Delete created files
```bash
# Backend
rm backend/alembic/versions/20260414_1200-027_add_ai_assistant_tables.py
rm backend/app/models/ai_assistant.py
rm backend/app/schemas/ai_assistant.py
rm backend/app/routers/ai_assistant.py
rm backend/app/services/ollama_service.py
rm backend/app/services/ai_api_client.py
rm backend/app/services/ai_tools.py
rm backend/app/services/ai_chat_service.py
rm backend/app/services/ai_system_prompt.py

# Frontend
rm -rf frontend/src/components/ai/
rm frontend/src/contexts/AIFormContext.tsx
rm frontend/src/hooks/useAIChat.ts
```

### Step 3: Revert modified files

**`backend/app/main.py`** — Remove:
- `from app.routers import ai_assistant` (in import block)
- `app.include_router(ai_assistant.router, prefix="/api/ai", tags=["ai-assistant"])`

**`backend/app/models/__init__.py`** — Remove:
- `from app.models.ai_assistant import AISettings, AIUpload, ChatMessage, ChatSession`
- Remove `AISettings`, `AIUpload`, `ChatMessage`, `ChatSession` from `__all__`

**`backend/requirements.txt`** — Remove:
- `sse-starlette==1.8.2`
- `pymupdf==1.25.3`

**`frontend/src/App.tsx`** — Remove:
- Imports: `ChatFAB`, `ChatPanel`, `AIFormProvider`, `aiApi`
- State: `isChatOpen`, `aiEnabled`, the `useEffect` that fetches AI settings
- JSX: `<AIFormProvider>` wrapper, `<ChatFAB>`, `<ChatPanel>`

**`frontend/src/services/api.ts`** — Remove:
- AI type imports (`AISettings`, `AISettingsUpdate`, `OllamaModel`, `OllamaHealth`, `ChatSession`, `ChatSessionDetail`, `AIUpload`)
- The entire `aiApi` object

**`frontend/src/types/index.ts`** — Remove:
- All interfaces after the `// AI Assistant` comment: `AISettings`, `AISettingsUpdate`, `OllamaModel`, `OllamaHealth`, `ChatSession`, `ChatMessage`, `ChatSessionDetail`, `ToolProposal`, `AIUpload`

**`frontend/src/pages/Settings.tsx`** — Remove:
- Imports: `aiApi`, `useAuth`, AI types, `Bot` icon
- State variables: `aiSettings`, `aiModels`, `aiHealth`, `aiLoading`, `aiSaving`, `aiTesting`, `aiForm`
- Functions: `loadAiSettings`, `testAiConnection`, `saveAiSettings`
- `'ai'` from `activeTab` type union
- AI tab button in nav
- AI tab content (`{activeTab === 'ai' && ...}`)

**`frontend/src/pages/Invoices.tsx`** — Remove:
- `useAIForm` import and usage
- `invoiceInitialData` / `supplierInvoiceInitialData` state
- `useEffect` watching `pendingForm`
- `initialData` prop on InvoiceForm and SupplierInvoiceForm

**`frontend/src/pages/Verifications.tsx`** — Remove:
- `useAIForm` import and usage
- `VerificationInitialData` import
- `verificationInitialData` state
- `useEffect` watching `pendingForm`
- `initialData` prop on VerificationForm

**`frontend/src/pages/Expenses.tsx`** — Remove:
- `useAIForm` import and usage
- `useEffect` watching `pendingForm`

**`frontend/src/pages/Customers.tsx`** — Remove:
- `useAIForm` import and usage
- `useEffect` watching `pendingForm`

**`frontend/src/components/forms/InvoiceForm.tsx`** — Remove:
- `InvoiceInitialData` interface
- `initialData?` prop from `InvoiceFormProps`
- `initialData` from destructured props
- All `initialData?.xxx` fallbacks in state initializers (revert to plain defaults)

**`frontend/src/components/forms/SupplierInvoiceForm.tsx`** — Same pattern as InvoiceForm.

**`frontend/src/components/forms/VerificationForm.tsx`** — Same pattern. Remove `VerificationInitialData` interface, `initialData` prop, and fallbacks.

**`frontend/src/index.css`** — Remove all `.ai-markdown` styles (lines after `.animate-slide-in` block).

**`frontend/package.json`** — Remove `react-markdown` from dependencies.

### Step 4: Clean up uploads directory
```bash
rm -rf uploads/ai_uploads/
```

### Step 5: Rebuild
```bash
docker compose up --build -d
```
