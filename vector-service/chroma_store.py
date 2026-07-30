"""
ChromaDB 向量存储封装。
提供增删查操作，对接 ONNX Embedding。
"""

import chromadb
from chromadb.config import Settings

from config import CHROMA_PERSIST_DIR, CHROMA_COLLECTION

_client = None
_collections = {}
DEFAULT_CORPUS = "memory_fragments"
IMAGE_PROMPT_CORPUS = "image_prompt_knowledge"
CHAT_MEMORY_PREFIX = "memory_v2_"


def _collection_name(corpus: str) -> str:
    if corpus == DEFAULT_CORPUS:
        return CHROMA_COLLECTION
    if corpus == IMAGE_PROMPT_CORPUS:
        return f"{CHROMA_COLLECTION}_image_prompt_knowledge"
    if corpus.startswith(CHAT_MEMORY_PREFIX) and corpus[len(CHAT_MEMORY_PREFIX):].isalnum():
        return f"{CHROMA_COLLECTION}_{corpus}"
    raise ValueError(f"unsupported corpus: {corpus}")


def _get_collection(corpus: str = DEFAULT_CORPUS):
    global _client
    name = _collection_name(corpus)
    if name not in _collections:
        if _client is None:
            _client = chromadb.PersistentClient(
                path=CHROMA_PERSIST_DIR,
                settings=Settings(anonymized_telemetry=False),
            )
        _collections[name] = _client.get_or_create_collection(
            name=name,
            metadata={"hnsw:space": "cosine"},
            embedding_function=None,
        )
        print(f"[chroma] collection '{name}' ready, count={_collections[name].count()}")
    return _collections[name]


def upsert_memory(chroma_id: str, embedding: list[float], metadata: dict, text: str, corpus: str = DEFAULT_CORPUS):
    """插入或更新一条指定 corpus 的向量。"""
    col = _get_collection(corpus)
    col.upsert(
        ids=[chroma_id],
        embeddings=[embedding],
        metadatas=[metadata],
        documents=[text],
    )


def upsert_memories(items: list[dict], embeddings: list[list[float]], corpus: str = DEFAULT_CORPUS):
    """批量插入或更新同一 corpus 的向量。"""
    if not items:
        return
    if len(items) != len(embeddings):
        raise ValueError("items and embeddings length mismatch")
    col = _get_collection(corpus)
    col.upsert(
        ids=[item["chroma_id"] for item in items],
        embeddings=embeddings,
        metadatas=[item.get("metadata", {}) for item in items],
        documents=[item["text"] for item in items],
    )


def search_similar(embedding: list[float], top_k: int = 20, filter_type: str = None, conversation_id: str = None, corpus: str = DEFAULT_CORPUS) -> list[dict]:
    """
    向量相似检索。

    Args:
        embedding: 查询嵌入向量
        top_k: 返回结果数
        filter_type: 可选过滤 fragment_type ('fact'/'preference'/'emotion')
        conversation_id: 可选过滤 conversation_id

    Returns:
        [{id, score, metadata, document}, ...]
    """
    col = _get_collection(corpus)
    if col.count() == 0:
        return []
    # 构建 ChromaDB where 条件（支持多条件 AND 组合）
    conditions = []
    if filter_type:
        conditions.append({"fragment_type": filter_type})
    if conversation_id:
        conditions.append({"conversation_id": conversation_id})
    where = {"$and": conditions} if len(conditions) > 1 else (conditions[0] if len(conditions) == 1 else None)

    results = col.query(
        query_embeddings=[embedding],
        n_results=min(top_k, col.count()),
        where=where,
        include=["metadatas", "documents", "distances"],
    )

    items = []
    if results["ids"] and results["ids"][0]:
        for i, chroma_id in enumerate(results["ids"][0]):
            items.append({
                "id": chroma_id,
                "score": 1 - results["distances"][0][i],
                "metadata": results["metadatas"][0][i] if results["metadatas"][0] else {},
                "document": results["documents"][0][i] if results["documents"][0] else "",
            })

    return items


def delete_by_id(chroma_id: str, corpus: str = DEFAULT_CORPUS):
    """删除指定 corpus 的单条向量。"""
    col = _get_collection(corpus)
    col.delete(ids=[chroma_id])


def delete_by_metadata(where_filter: dict, corpus: str = DEFAULT_CORPUS) -> int:
    """按元数据条件批量删除记忆向量

    Args:
        where_filter: ChromaDB where 条件，如 {"conversation_id": "char_5"}

    Returns:
        删除的向量数量
    """
    col = _get_collection(corpus)
    # 先查询匹配的 ids，再按 ids 删除（ChromaDB delete 支持 where 但需先获得匹配 id 列表才能计数）
    results = col.get(where=where_filter, include=[])
    if results["ids"]:
        col.delete(ids=results["ids"])
    return len(results["ids"])


def collection_count(corpus: str = DEFAULT_CORPUS) -> int:
    return _get_collection(corpus).count()
