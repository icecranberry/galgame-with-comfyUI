"""
Jina v2 base zh ONNX 嵌入推理
模型下载自: https://huggingface.co/Xenova/jina-embeddings-v2-base-zh
"""

import numpy as np
from transformers import AutoTokenizer
import onnxruntime as ort

from config import MODEL_PATH, USE_QUANTIZED

_tokenizer = None
_session = None


def _get_tokenizer():
    global _tokenizer
    if _tokenizer is None:
        _tokenizer = AutoTokenizer.from_pretrained(
            MODEL_PATH,
            trust_remote_code=True,
        )
    return _tokenizer


def _get_session():
    global _session
    if _session is None:
        # 选择合适的 ONNX 模型文件
        if USE_QUANTIZED:
            model_file = f"{MODEL_PATH}/onnx/model_int8.onnx"
        else:
            model_file = f"{MODEL_PATH}/onnx/model.onnx"

        providers = ort.get_available_providers()
        _session = ort.InferenceSession(model_file, providers=providers)
        print(f"[embedding] ONNX session loaded, providers={_session.get_providers()}")
        print(f"[embedding] model: {model_file}")
    return _session


def embed(texts: list[str]) -> list[list[float]]:
    """
    将文本列表转换为嵌入向量。

    Args:
        texts: 文本列表

    Returns:
        嵌入向量列表，每个向量 768 维
    """
    if not texts:
        return []

    tokenizer = _get_tokenizer()
    session = _get_session()

    embeddings = []

    for text in texts:
        encoded = tokenizer(
            text,
            padding=True,
            truncation=True,
            max_length=8192,
            return_tensors="np",
        )

        inputs = {
            "input_ids": encoded["input_ids"],
            "attention_mask": encoded["attention_mask"],
        }

        # 检查模型输入
        model_inputs = [inp.name for inp in session.get_inputs()]
        session_inputs = {}
        for key in model_inputs:
            if key in inputs:
                session_inputs[key] = inputs[key]
            elif key == "token_type_ids":
                session_inputs[key] = np.zeros_like(inputs["input_ids"])

        outputs = session.run(None, session_inputs)

        # 取 [CLS] token 或 mean pooling
        hidden = outputs[0]  # shape: (1, seq_len, 768)

        # Mean pooling over sequence (with attention mask)
        mask = inputs["attention_mask"][:, :, None]
        masked = hidden * mask
        pooled = masked.sum(axis=1) / mask.sum(axis=1)

        # L2 normalize
        norm = np.linalg.norm(pooled, axis=1, keepdims=True)
        normalized = pooled / (norm + 1e-9)

        embeddings.append(normalized[0].tolist())

    return embeddings


def embed_single(text: str) -> list[float]:
    """单文本嵌入"""
    return embed([text])[0]
