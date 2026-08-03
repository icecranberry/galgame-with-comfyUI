"""Jina v2 base zh ONNX 嵌入推理（模型来自 https://huggingface.co/Xenova/jina-embeddings-v2-base-zh）

双会话：
- chat 会话（/embed、/search）：聊天流 RAG，默认 4 线程
- index 会话（/upsert、/upsert-batch、/embed-index）：记忆整理，默认 2 线程
"""

import numpy as np
from transformers import AutoTokenizer
import onnxruntime as ort

from config import (
    MODEL_PATH,
    USE_QUANTIZED,
    EMBED_MAX_LENGTH,
    EMBED_CHAT_NUM_THREADS,
    EMBED_INDEX_NUM_THREADS,
    EMBED_PREFER_GPU,
)

_tokenizer = None
_sessions = {}

# 优先使用的 GPU 执行后端（按顺序），都没有时退回 CPU
_GPU_PROVIDER_PRIORITY = ("CUDAExecutionProvider", "DmlExecutionProvider", "TensorrtExecutionProvider")


def _get_tokenizer():
    global _tokenizer
    if _tokenizer is None:
        _tokenizer = AutoTokenizer.from_pretrained(MODEL_PATH)
    return _tokenizer


def _get_session(kind="chat"):
    session = _sessions.get(kind)
    if session is None:
        # 选择合适的 ONNX 模型文件
        if USE_QUANTIZED:
            model_file = f"{MODEL_PATH}/onnx/model_int8.onnx"
        else:
            model_file = f"{MODEL_PATH}/onnx/model.onnx"

        threads = EMBED_CHAT_NUM_THREADS if kind == "chat" else EMBED_INDEX_NUM_THREADS

        sess_options = ort.SessionOptions()
        # 限制 CPU 线程数：聊天流快、记忆整理让路
        sess_options.intra_op_num_threads = threads
        sess_options.inter_op_num_threads = 1
        sess_options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL

        available = ort.get_available_providers()
        ordered = list(available)
        tried_gpu = False
        if EMBED_PREFER_GPU:
            preferred = [p for p in _GPU_PROVIDER_PRIORITY if p in available]
            if preferred:
                tried_gpu = True
                ordered = preferred + [p for p in available if p not in preferred]

        try:
            session = ort.InferenceSession(model_file, sess_options=sess_options, providers=ordered)
        except Exception as exc:
            if tried_gpu:
                print(f"[embedding:{kind}] GPU provider unavailable ({exc}), falling back to CPU")
                session = ort.InferenceSession(
                    model_file, sess_options=sess_options, providers=["CPUExecutionProvider"]
                )
            else:
                raise

        _sessions[kind] = session
        print(
            f"[embedding:{kind}] ONNX session loaded, providers={session.get_providers()}, "
            f"threads={threads}, max_length={EMBED_MAX_LENGTH}, model={model_file}"
        )
    return session


def embed(texts: list[str], kind: str = "chat") -> list[list[float]]:
    """将文本列表批量转换为嵌入向量（768 维）。kind: chat=聊天流, index=记忆整理。"""
    if not texts:
        return []

    tokenizer = _get_tokenizer()
    session = _get_session(kind)

    # 整批 tokenize + 单次 session.run，比逐条推理快得多
    encoded = tokenizer(
        list(texts),
        padding=True,
        truncation=True,
        max_length=EMBED_MAX_LENGTH,
        return_tensors="np",
    )

    model_inputs = [inp.name for inp in session.get_inputs()]
    session_inputs = {}
    for key in model_inputs:
        if key in encoded:
            session_inputs[key] = encoded[key]
        elif key == "token_type_ids":
            session_inputs[key] = np.zeros_like(encoded["input_ids"])

    outputs = session.run(None, session_inputs)
    hidden = outputs[0]  # shape: (batch, seq_len, 768)

    # Mean pooling over sequence（带 attention mask），再 L2 normalize
    mask = encoded["attention_mask"][:, :, None].astype(hidden.dtype)
    masked = hidden * mask
    pooled = masked.sum(axis=1) / mask.sum(axis=1)
    norm = np.linalg.norm(pooled, axis=1, keepdims=True)
    normalized = pooled / (norm + 1e-9)

    return normalized.tolist()


def embed_single(text: str, kind: str = "chat") -> list[float]:
    """单文本嵌入。"""
    return embed([text], kind)[0]
