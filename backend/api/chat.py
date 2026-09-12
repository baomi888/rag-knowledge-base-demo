# -*- coding: utf-8 -*-
"""流式问答接口（SSE）：
- POST /stream  请求体 JSON，逐 token 推送累计答案与参考片段
"""

import asyncio
import json

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

import rag_core
from core.pipelines import get_pipeline
from schemas import ChatRequest

router = APIRouter()

# SSE 响应头：禁缓存、禁代理缓冲
SSE_HEADERS = {
    "Cache-Control": "no-cache",
    "X-Accel-Buffering": "no",
    "Connection": "keep-alive",
}


def _sse(event: str, data: dict) -> str:
    """按 SSE 规范拼装一帧：event 行 + data 行 + 空行结束。"""
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@router.post("/stream")
async def chat_stream(req: ChatRequest, request: Request):
    if req.kb not in ("main", "left", "right"):
        raise HTTPException(status_code=400, detail=f"未知知识库：{req.kb}")

    pipeline = get_pipeline(req.kb)

    async def event_generator():
        # 1) 开始状态
        yield _sse("status", {"text": "正在检索知识库..."})

        # answer_stream 是同步生成器，放到线程池里拉取下一项，避免阻塞事件循环
        gen = pipeline.answer_stream(req.question, req.top_k)
        last_text, last_refs = "", ""
        _DONE = object()  # 哨兵：StopIteration 不能跨线程抛进 Future，用 next 的默认值代替
        try:
            while True:
                # 客户端断开则终止
                if await request.is_disconnected():
                    return
                try:
                    item = await asyncio.to_thread(lambda g=gen: next(g, _DONE))
                except RuntimeError as e:
                    # 知识库为空等业务异常
                    yield _sse("error", {"detail": str(e)})
                    return
                except Exception as e:
                    # openai 等底层异常统一转中文
                    yield _sse("error", {"detail": rag_core.describe_api_error(e)})
                    return

                if item is _DONE:
                    break
                text, refs = item
                # 第一个 yield 可能 text 为空（检索完成先展示来源），直接透传即可
                last_text, last_refs = text, refs
                yield _sse("token", {"text": text, "refs": refs})
        finally:
            # 妥善关闭底层生成器（断开时清理资源）
            close = getattr(gen, "close", None)
            if close is not None:
                try:
                    await asyncio.to_thread(close)
                except Exception:
                    pass

        # 2) 完成事件：携带完整答案与参考片段
        yield _sse("done", {"answer": last_text, "refs": last_refs})

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers=SSE_HEADERS,
    )
