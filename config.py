# -*- coding: utf-8 -*-
"""
Demo6 · 集中配置管理（第6周 Gradio 网页版）

所有 API Key、地址、路径、默认参数统一在此读取，业务代码禁止硬编码。
密钥一律来自 .env（已被 .gitignore 忽略，严禁提交）。
"""

import os

from dotenv import load_dotenv

load_dotenv()  # 从项目根目录加载 .env

# ---------- 大模型（对话）----------
DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY", "")
DEEPSEEK_BASE_URL = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
DEEPSEEK_MODEL = os.getenv("DEEPSEEK_MODEL", "deepseek-chat")

# ---------- Embedding（向量化）----------
# 未单独配置 EMBEDDING_API_KEY 时回退复用 DEEPSEEK_API_KEY（同一平台双模型时适用）
EMBEDDING_API_KEY = os.getenv("EMBEDDING_API_KEY", DEEPSEEK_API_KEY)
EMBEDDING_BASE_URL = os.getenv("EMBEDDING_BASE_URL", "")
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "text-embedding-v3")

# ---------- 路径 ----------
DATA_DIR = os.getenv("DATA_DIR", "data")
PERSIST_DIR = os.getenv("PERSIST_DIR", "chroma_db")  # Chroma 持久化目录（已 gitignore）
DEFAULT_FILES = [
    os.path.join(DATA_DIR, "sample.txt"),
    os.path.join(DATA_DIR, "test.pdf"),
    os.path.join(DATA_DIR, "nba.txt"),          # 体育主题
    os.path.join(DATA_DIR, "science.txt"),      # 天文物理科普主题
    os.path.join(DATA_DIR, "entertainment.txt"),  # 影视音乐娱乐主题
]

# ---------- 默认参数（网页滑块的初始值）----------
CHUNK_SIZE_DEFAULT = int(os.getenv("CHUNK_SIZE", "500"))
CHUNK_OVERLAP_DEFAULT = int(os.getenv("CHUNK_OVERLAP", "50"))
TOP_K_DEFAULT = int(os.getenv("TOP_K", "3"))

# Embedding 接口单次批量上限（阿里百炼为 10）
EMBED_BATCH_SIZE = int(os.getenv("EMBED_BATCH_SIZE", "10"))


def validate() -> list:
    """启动前校验关键配置，返回缺失项的中文提示列表。"""
    missing = []
    if not DEEPSEEK_API_KEY:
        missing.append("缺少 DEEPSEEK_API_KEY（大模型对话密钥）")
    if not EMBEDDING_BASE_URL:
        missing.append("缺少 EMBEDDING_BASE_URL（向量化服务地址）")
    return missing
