import os

# ChromaDB
CHROMA_PERSIST_DIR = os.getenv("CHROMA_PERSIST_DIR", "./chroma_data")
CHROMA_COLLECTION = os.getenv("CHROMA_COLLECTION", "memory_fragments")

# ONNX Embedding
MODEL_PATH = os.getenv("MODEL_PATH", "./models/jina-embeddings-v2-base-zh")
USE_QUANTIZED = os.getenv("USE_QUANTIZED", "true").lower() == "true"

# Server
HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", "8765"))

# ONNX Embedding 调优
EMBED_MAX_LENGTH = int(os.getenv("EMBED_MAX_LENGTH", "1024"))   # 输入最大 token 数（原 8192 过重）
EMBED_PREFER_GPU = os.getenv("EMBED_PREFER_GPU", "true").lower() == "true"  # 优先 CUDA/DirectML
EMBED_CHAT_NUM_THREADS = int(os.getenv("EMBED_CHAT_NUM_THREADS", "4"))   # 聊天流（/embed、/search）推理线程（默认 4，性价比更高）
EMBED_INDEX_NUM_THREADS = int(os.getenv("EMBED_INDEX_NUM_THREADS", "2"))  # 记忆整理（/upsert、/upsert-batch、/embed-index）推理线程
