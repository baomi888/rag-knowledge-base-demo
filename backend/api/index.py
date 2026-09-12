# -*- coding: utf-8 -*-
"""索引相关接口：
- GET    /status         查看三个库当前状态
- POST   /build          （可选）上传新文件 + 按新切片参数重建指定库
- DELETE /file           从指定库移除一个文件并自动重建索引
- GET    /file/content   预览 data/ 内文件内容（引用弹窗原文预览用）
"""

import os
import re

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile

import config
import rag_core
from core.pipelines import (
    KB_FILES,
    VALID_KEYS,
    add_files,
    get_pipeline,
    get_status,
    remove_file,
    reset_kb,
)

router = APIRouter()

# 上传大小上限 50MB
MAX_UPLOAD_BYTES = 50 * 1024 * 1024


def _safe_filename(name: str) -> str:
    """生成安全文件名：剥离路径成分，只保留安全字符，避免路径穿越。"""
    name = os.path.basename(name or "").strip()
    # 保留中英文、数字、点、下划线、短横线，其余替换为下划线
    name = re.sub(r"[^\w.\-\u4e00-\u9fff]", "_", name)
    return name or "upload"


@router.get("/status")
def index_status():
    """返回三个库的状态（磁盘片段数 + 参数 + 文件列表）。"""
    return {key: get_status(key) for key in VALID_KEYS}


@router.post("/build")
def index_build(
    kb: str = Form(default="main", description="目标知识库 main/left/right"),
    chunk_size: int = Form(default=config.CHUNK_SIZE_DEFAULT, description="切片大小"),
    chunk_overlap: int = Form(default=config.CHUNK_OVERLAP_DEFAULT, description="切片重叠"),
    files: list[UploadFile] | None = File(default=None, description="可选，多个待上传文件"),
):
    """重建指定库索引；可附带上传新文件（保存到 data/uploads/）。"""
    # ---- 参数校验 ----
    if kb not in VALID_KEYS:
        raise HTTPException(status_code=400, detail=f"未知知识库：{kb}（可选 main/left/right）")
    if chunk_size <= 0:
        raise HTTPException(status_code=400, detail="chunk_size 必须为正整数")
    if chunk_overlap < 0:
        raise HTTPException(status_code=400, detail="chunk_overlap 不能为负数")

    pipeline = get_pipeline(kb)

    # ---- 准备上传目录 ----
    upload_dir = os.path.join(config.DATA_DIR, "uploads")
    os.makedirs(upload_dir, exist_ok=True)

    # ---- 保存上传文件（允许不传文件，仅改参数重建）----
    new_paths: list[str] = []
    for uf in (files or []):
        if uf is None:
            continue
        content = uf.file.read()
        if not content:
            continue
        # 50MB 限制
        if len(content) > MAX_UPLOAD_BYTES:
            raise HTTPException(
                status_code=413,
                detail=f"文件 {uf.filename} 超过 50MB 上传限制",
            )
        # 扩展名白名单
        ext = os.path.splitext(uf.filename or "")[1].lower()
        if ext not in rag_core.SUPPORTED_EXT:
            raise HTTPException(
                status_code=400,
                detail=f"不支持的文件格式：{ext}（仅支持 {', '.join(rag_core.SUPPORTED_EXT)}）",
            )
        # 写入磁盘
        fname = _safe_filename(uf.filename)
        fpath = os.path.join(upload_dir, fname)
        with open(fpath, "wb") as f:
            f.write(content)
        new_paths.append(fpath)

    # 把新文件追加到该库的文件列表
    if new_paths:
        add_files(kb, new_paths)

    # ---- 重建索引（使用该库当前完整文件列表）----
    try:
        chunks = pipeline.build_index(
            chunk_size, chunk_overlap, paths=list(KB_FILES[kb])
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=rag_core.describe_api_error(e)
        )

    return {
        "chunks": chunks,
        "status": f"索引构建完成，共 {chunks} 个片段",
        "kb": kb,
        "files": list(KB_FILES[kb]),
    }


@router.delete("/file")
def index_delete_file(
    kb: str = Query(description="目标知识库 main/left/right"),
    file: str = Query(description="要移除的文件完整路径（须在该库文件列表中）"),
):
    """从指定库移除一个文件并自动重建索引。

    - 仅移除 data/uploads/ 目录内的文件时会同时删除磁盘文件；
      默认知识库文件（data/ 下）只移出列表，不删磁盘。
    - 移除后若该库无剩余文件，则直接清空该库（chunks=0）。
    """
    if kb not in VALID_KEYS:
        raise HTTPException(status_code=400, detail=f"未知知识库：{kb}（可选 main/left/right）")

    if not remove_file(kb, file):
        raise HTTPException(status_code=404, detail=f"文件不在该知识库中：{file}")

    # 磁盘删除：仅限 uploads 目录内的文件（路径先 abspath 归一化再前缀匹配，防穿越）
    upload_dir = os.path.abspath(os.path.join(config.DATA_DIR, "uploads"))
    abs_file = os.path.abspath(file)
    if (
        abs_file.startswith(upload_dir + os.sep)
        and os.path.isfile(abs_file)
        and os.path.commonpath([abs_file, upload_dir]) == upload_dir
    ):
        try:
            os.remove(abs_file)
        except OSError:
            pass  # 磁盘删除失败不阻塞流程，列表已移除

    remaining = list(KB_FILES[kb])
    pipeline = get_pipeline(kb)

    if not remaining:
        reset_kb(kb)
        return {
            "chunks": 0,
            "status": "已移除全部文件，该知识库已清空",
            "kb": kb,
            "files": [],
        }

    # 沿用该库当前切片参数重建（未建过库则用默认值）
    params = pipeline._params or (config.CHUNK_SIZE_DEFAULT, config.CHUNK_OVERLAP_DEFAULT)
    try:
        chunks = pipeline.build_index(params[0], params[1], paths=remaining)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=rag_core.describe_api_error(e))

    return {
        "chunks": chunks,
        "status": f"已移除文件并重建索引，剩余 {chunks} 个片段",
        "kb": kb,
        "files": remaining,
    }


@router.get("/file/content")
def index_file_content(
    file: str = Query(description="文件路径（须位于 data/ 目录内）"),
    max_chars: int = Query(default=200_000, ge=1_000, le=1_000_000, description="返回的最大字符数"),
):
    """预览 data/ 目录内文件的文本内容（引用弹窗的「原文预览」用）。

    - 仅允许访问 DATA_DIR 之内的文件（abspath + commonpath 双重校验防穿越）；
    - .txt/.md 直接读文本（utf-8 失败回退 gbk）；.pdf 用 PyPDFLoader 提取；
    - 超过 max_chars 时截断并标记 truncated。
    """
    root = os.path.abspath(config.DATA_DIR)
    abs_file = os.path.abspath(file)
    try:
        inside = os.path.commonpath([abs_file, root]) == root
    except ValueError:  # 跨盘符等无法比较的情况
        inside = False
    if not inside:
        raise HTTPException(status_code=403, detail="仅允许预览 data/ 目录内的文件")
    if not os.path.isfile(abs_file):
        raise HTTPException(status_code=404, detail=f"文件不存在：{file}")

    ext = os.path.splitext(abs_file)[1].lower()
    if ext not in rag_core.SUPPORTED_EXT:
        raise HTTPException(status_code=400, detail=f"不支持的格式：{ext}")

    if ext == ".pdf":
        try:
            docs = rag_core.load_document(abs_file)
            full_text = "\n\n".join(d.page_content for d in docs)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"PDF 解析失败：{e}")
    else:
        full_text = None
        for enc in ("utf-8", "gbk"):
            try:
                with open(abs_file, encoding=enc) as f:
                    full_text = f.read()
                break
            except UnicodeDecodeError:
                continue
        if full_text is None:
            raise HTTPException(status_code=400, detail="无法解码文本文件（非 UTF-8/GBK）")

    total = len(full_text)
    return {
        "file": file,
        "name": os.path.basename(abs_file),
        "ext": ext,
        "content": full_text[:max_chars],
        "total_chars": total,
        "truncated": total > max_chars,
    }
