"""
Python FastAPI 向量服务
提供嵌入推理和向量检索引擎

启动: uvicorn server:app --host 0.0.0.0 --port 8765
"""

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
import uuid

from embedding import embed, embed_single
from chroma_store import upsert_memory, search_similar, delete_by_id, collection_count

app = FastAPI(title="Vector Service", version="1.0.0")


# ── Request / Response models ──

class EmbedRequest(BaseModel):
    text: str | list[str] = Field(..., description="文本或文本列表")


class EmbedResponse(BaseModel):
    embeddings: list[list[float]]


class SearchRequest(BaseModel):
    text: str = Field(..., description="查询文本")
    top_k: int = Field(default=20, ge=1, le=100)
    filter_type: str | None = Field(default=None, pattern="^(fact|preference|emotion)$")


class SearchResult(BaseModel):
    id: str
    score: float
    metadata: dict
    document: str


class SearchResponse(BaseModel):
    results: list[SearchResult]


class UpsertRequest(BaseModel):
    chroma_id: str | None = None
    text: str
    metadata: dict = Field(default_factory=dict)
    fragment_type: str | None = None


class UpsertResponse(BaseModel):
    chroma_id: str


class DeleteRequest(BaseModel):
    chroma_id: str


# ── Routes ──

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "collection_count": collection_count(),
    }


@app.post("/embed", response_model=EmbedResponse)
async def embed_route(req: EmbedRequest):
    texts = req.text if isinstance(req.text, list) else [req.text]
    try:
        embeddings = embed(texts)
        return EmbedResponse(embeddings=embeddings)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/search", response_model=SearchResponse)
async def search_route(req: SearchRequest):
    try:
        vec = embed_single(req.text)
        items = search_similar(vec, top_k=req.top_k, filter_type=req.filter_type)
        return SearchResponse(
            results=[SearchResult(**item) for item in items]
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/upsert", response_model=UpsertResponse)
async def upsert_route(req: UpsertRequest):
    try:
        vec = embed_single(req.text)
        chroma_id = req.chroma_id or str(uuid.uuid4())

        metadata = {**req.metadata}
        if req.fragment_type:
            metadata["fragment_type"] = req.fragment_type

        upsert_memory(chroma_id, vec, metadata, req.text)
        return UpsertResponse(chroma_id=chroma_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/delete")
async def delete_route(req: DeleteRequest):
    try:
        delete_by_id(req.chroma_id)
        return {"ok": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Startup ──

@app.on_event("startup")
async def startup():
    print("[vector-service] startup — warming up embedding model...")
    try:
        embed_single("预热")
        print("[vector-service] embedding model warm-up complete")
    except Exception as e:
        print(f"[vector-service] warm-up failed: {e}")
        # 不阻止启动，首次请求时会有延迟


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8765)
