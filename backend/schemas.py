# -*- coding: utf-8 -*-
"""Pydantic 请求模型。"""

from pydantic import BaseModel, Field

import config


class ChunkParams(BaseModel):
    """切片参数（对比接口左右两栏各自一份）。"""

    chunk_size: int = Field(default=config.CHUNK_SIZE_DEFAULT, gt=0, description="切片大小")
    chunk_overlap: int = Field(default=config.CHUNK_OVERLAP_DEFAULT, ge=0, description="切片重叠")


class ChatRequest(BaseModel):
    """流式问答请求体。"""

    question: str = Field(..., description="用户问题")
    top_k: int = Field(default=config.TOP_K_DEFAULT, gt=0, description="检索条数")
    kb: str = Field(default="main", description="目标知识库：main/left/right")


class CompareRequest(BaseModel):
    """左右两栏参数对比请求体。"""

    question: str = Field(..., description="用户问题")
    top_k: int = Field(default=config.TOP_K_DEFAULT, gt=0, description="检索条数")
    left_params: ChunkParams = Field(default_factory=ChunkParams, description="左栏切片参数")
    right_params: ChunkParams = Field(default_factory=ChunkParams, description="右栏切片参数")
