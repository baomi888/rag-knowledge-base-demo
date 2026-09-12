# -*- coding: utf-8 -*-
"""三个独立 RAG 链路的单例管理 + 各知识库文件列表状态。

- main  : kb_main  collection，主问答链路
- left  : kb_left  collection，对比左栏
- right : kb_right collection，对比右栏
"""

import chromadb

import config
import rag_core

# 三个独立 collection，物理隔离向量库
PIPELINES: dict[str, rag_core.RagPipeline] = {
    "main": rag_core.RagPipeline("kb_main"),
    "left": rag_core.RagPipeline("kb_left"),
    "right": rag_core.RagPipeline("kb_right"),
}

# 每个库独立维护当前使用的文件路径列表（初始均为默认文件集）
KB_FILES: dict[str, list] = {
    "main": list(config.DEFAULT_FILES),
    "left": list(config.DEFAULT_FILES),
    "right": list(config.DEFAULT_FILES),
}

VALID_KEYS = tuple(PIPELINES.keys())


def _check_key(key: str) -> None:
    if key not in PIPELINES:
        raise KeyError(f"未知知识库：{key}（可选 main/left/right）")


def get_pipeline(key: str) -> rag_core.RagPipeline:
    """按 key 取对应 RagPipeline 单例。"""
    _check_key(key)
    return PIPELINES[key]


def get_files(key: str) -> list:
    """返回该库当前文件路径列表的副本。"""
    _check_key(key)
    return list(KB_FILES[key])


def set_files(key: str, paths) -> None:
    """整体替换该库的文件列表。"""
    _check_key(key)
    KB_FILES[key] = list(paths)


def add_files(key: str, paths) -> None:
    """向该库追加文件路径。"""
    _check_key(key)
    KB_FILES[key].extend(paths)


def remove_file(key: str, path: str) -> bool:
    """从该库文件列表中移除指定路径，返回是否移除成功。"""
    _check_key(key)
    if path in KB_FILES[key]:
        KB_FILES[key].remove(path)
        return True
    return False


def reset_kb(key: str) -> None:
    """清空该库：删除磁盘 collection 并重置内存状态（文件数归零时使用）。"""
    p = get_pipeline(key)
    try:
        client = chromadb.PersistentClient(path=config.PERSIST_DIR)
        client.delete_collection(p.collection_name)
    except Exception:
        pass  # 库不存在时忽略
    p._vs = None
    p._params = None


def get_status(key: str) -> dict:
    """汇总单个库状态：磁盘片段数 + 切片参数 + 文件列表。

    - chunks  来自 peek()（磁盘实际数，未建库为 0）
    - chunk_size / chunk_overlap 来自 _params（未建库为 None）
    - files   来自内存中的 KB_FILES 状态
    """
    p = get_pipeline(key)
    chunks = p.peek()
    params = p._params
    return {
        "chunks": chunks,
        "chunk_size": params[0] if params else None,
        "chunk_overlap": params[1] if params else None,
        "files": list(KB_FILES[key]),
    }


def warmup() -> None:
    """启动时预热：仅 peek 磁盘状态，不触发建库。"""
    for key in VALID_KEYS:
        try:
            PIPELINES[key].peek()
        except Exception:
            # 磁盘库尚不存在时 peek 已内部吞掉异常，这里再兜底
            pass
