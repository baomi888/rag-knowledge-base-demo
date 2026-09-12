# -*- coding: utf-8 -*-
"""左右两栏参数对比接口：
- POST /  同一问题，用 left/right 两个库以各自切片参数同步问答并返回结果
"""

from fastapi import APIRouter

import rag_core
from core.pipelines import KB_FILES, get_pipeline
from schemas import CompareRequest

router = APIRouter()


def _run_side(key: str, question: str, top_k: int, chunk_size: int, chunk_overlap: int) -> dict:
    """跑单侧问答：先 get_or_build 确保库就绪，再同步 answer。

    单侧出错不抛出，而是返回带 status=error 的 dict，保证另一侧正常返回。
    """
    pipeline = get_pipeline(key)
    try:
        chunks = pipeline.get_or_build(
            chunk_size, chunk_overlap, paths=list(KB_FILES[key])
        )
        answer_text, refs = pipeline.answer(question, top_k)
    except RuntimeError as e:
        return {"status": "error", "detail": str(e)}
    except Exception as e:
        return {"status": "error", "detail": rag_core.describe_api_error(e)}

    return {
        "status": "ok",
        "chunk_size": chunk_size,
        "chunk_overlap": chunk_overlap,
        "chunks": chunks,
        "answer": answer_text,
        "refs": refs,
    }


@router.post("")
def compare(req: CompareRequest):
    """左右两栏独立 try/except，互不影响。"""
    left = _run_side(
        "left", req.question, req.top_k,
        req.left_params.chunk_size, req.left_params.chunk_overlap,
    )
    right = _run_side(
        "right", req.question, req.top_k,
        req.right_params.chunk_size, req.right_params.chunk_overlap,
    )
    return {"left": left, "right": right}
