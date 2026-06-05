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
