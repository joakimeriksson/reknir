import json
from collections.abc import AsyncGenerator

import httpx

OLLAMA_TIMEOUT = 300.0


async def check_health(ollama_url: str) -> dict:
    """Check if Ollama is reachable by listing models."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(f"{ollama_url}/api/tags")
            resp.raise_for_status()
            return {"reachable": True}
    except Exception as e:
        return {"reachable": False, "error": str(e)}


async def list_models(ollama_url: str) -> list[dict]:
    """List available models from Ollama."""
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(f"{ollama_url}/api/tags")
        resp.raise_for_status()
        data = resp.json()

    models = []
    for m in data.get("models", []):
        details = m.get("details", {})
        models.append(
            {
                "name": m.get("name", ""),
                "size": m.get("size"),
                "parameter_size": details.get("parameter_size"),
                "quantization_level": details.get("quantization_level"),
                "modified_at": m.get("modified_at"),
            }
        )
    return models


async def test_model(ollama_url: str, model: str) -> dict:
    """Test that a model can actually generate a response."""
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{ollama_url}/api/chat",
                json={
                    "model": model,
                    "messages": [{"role": "user", "content": "Svara med ett ord: fungerar."}],
                    "stream": False,
                },
            )
            resp.raise_for_status()
            return {"success": True}
    except Exception as e:
        return {"success": False, "error": str(e)}


async def chat_generate(
    ollama_url: str,
    model: str,
    messages: list[dict],
) -> str:
    """Non-streaming chat — returns the full response text."""
    async with httpx.AsyncClient(timeout=OLLAMA_TIMEOUT) as client:
        resp = await client.post(
            f"{ollama_url}/api/chat",
            json={"model": model, "messages": messages, "stream": False},
        )
        resp.raise_for_status()
        return resp.json().get("message", {}).get("content", "")


async def chat_stream(
    ollama_url: str,
    model: str,
    messages: list[dict],
    tools: list[dict] | None = None,
) -> AsyncGenerator[dict, None]:
    """Stream chat responses from Ollama. Yields parsed JSON chunks."""
    body: dict = {
        "model": model,
        "messages": messages,
        "stream": True,
    }
    if tools:
        body["tools"] = tools

    async with httpx.AsyncClient(timeout=OLLAMA_TIMEOUT) as client:
        async with client.stream("POST", f"{ollama_url}/api/chat", json=body) as resp:
            resp.raise_for_status()
            async for line in resp.aiter_lines():
                line = line.strip()
                if not line:
                    continue
                try:
                    chunk = json.loads(line)
                    yield chunk
                except json.JSONDecodeError:
                    continue
