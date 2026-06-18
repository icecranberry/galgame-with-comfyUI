"""
ChromaDB 向量存储封装。
提供增删查操作，对接 ONNX Embedding。
"""

import chromadb
from chromadb.config import Settings

from config import CHROMA_PERSIST_DIR, CHROMA_COLLECTION

_client = None
_collection = None


def _get_collection():
    global _client, _collection
    if _collection is None:
        _client = chromadb.PersistentClient(
            path=CHROMA_PERSIST_DIR,
            settings=Settings(anonymized_telemetry=False),
        )
        _collection = _client.get_or_create_collection(
            name=CHROMA_COLLECTION,
            metadata={"hnsw:space": "cosine"},
            embedding_function=None,
        )
        print(f"[chroma] collection '{CHROMA_COLLECTION}' ready, count={_collection.count()}")
    return _collection


def upsert_memory(chroma_id: str, embedding: list[float], metadata: dict, text: str):
    """插入或更新一条记忆碎片向量"""
    col = _get_collection()
    col.upsert(
        ids=[chroma_id],
        embeddings=[embedding],
        metadatas=[metadata],
        documents=[text],
    )


def search_similar(embedding: list[float], top_k: int = 20, filter_type: str = None, conversation_id: str = None) -> list[dict]:
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
    col = _get_collection()
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


def delete_by_id(chroma_id: str):
    """删除单条记忆向量"""
    col = _get_collection()
    col.delete(ids=[chroma_id])


def delete_by_metadata(where_filter: dict) -> int:
    """按元数据条件批量删除记忆向量

    Args:
        where_filter: ChromaDB where 条件，如 {"conversation_id": "char_5"}

    Returns:
        删除的向量数量
    """
    col = _get_collection()
    # 先查询匹配的 ids，再按 ids 删除（ChromaDB delete 支持 where 但需先获得匹配 id 列表才能计数）
    results = col.get(where=where_filter, include=[])
    if results["ids"]:
        col.delete(ids=results["ids"])
    return len(results["ids"])


def collection_count() -> int:
    return _get_collection().count()
