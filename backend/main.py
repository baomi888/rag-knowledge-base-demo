# -*- coding: utf-8 -*-
"""FastAPI 后端入口。

关键启动逻辑（见 agent-hint）：
1. 无论从哪个目录启动，都先用 abspath 定位项目根目录；
2. 把根目录加入 sys.path，以便 import rag_core / config；
3. 把 backend 目录加入 sys.path，以便 import api / core / schemas 等本包模块；
4. os.chdir 到项目根目录，使 config 内的 load_dotenv() 与相对路径
   （data/、chroma_db/）都按根目录解析；
5. 同步把根目录与 backend 目录写入 PYTHONPATH，保证 uvicorn --reload
   重启的子进程也能找到这些模块。
"""

import os
import sys
from contextlib import asynccontextmanager

# ---------- 路径预处理（必须在 import config / rag_core 之前完成）----------
BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(BACKEND_DIR)

for _p in (ROOT_DIR, BACKEND_DIR):
    if _p not in sys.path:
        sys.path.insert(0, _p)

# 让 reload 重启的子进程继承模块搜索路径
os.environ["PYTHONPATH"] = os.pathsep.join(
    [ROOT_DIR, BACKEND_DIR, os.environ.get("PYTHONPATH", "")]
)

# 切换工作目录到项目根，使相对路径 .env / data / chroma_db 全部正确解析
os.chdir(ROOT_DIR)

# ---------- 此时再导入根模块与本包模块 ----------
import config  # noqa: E402  （上面 chdir / sys.path 已就绪）
import rag_core  # noqa: E402

from fastapi import FastAPI  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402

from api.chat import router as chat_router  # noqa: E402
from api.compare import router as compare_router  # noqa: E402
from api.index import router as index_router  # noqa: E402
from core.pipelines import warmup  # noqa: E402

MAX_UPLOAD_MB = 50


@asynccontextmanager
async def lifespan(app: FastAPI):
    """启动事件：预热三个库的磁盘状态 + 配置缺失提示。"""
    warmup()
    missing = config.validate()
    if missing:
        print("[启动警告] 配置缺失：" + "；".join(missing))
    yield


app = FastAPI(title="RAG 知识库后端", version="1.0.0", lifespan=lifespan)

# ---------- CORS：仅允许本地前端开发端口 ----------
# 本地开发端口可能自动避让（如 3000 被 vmnat 占用时前端换 3100），
# 因此用正则放行所有 localhost / 127.0.0.1 端口。
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------- 路由挂载 ----------
app.include_router(index_router, prefix="/api/index", tags=["index"])
app.include_router(chat_router, prefix="/api/chat", tags=["chat"])
app.include_router(compare_router, prefix="/api/compare", tags=["compare"])


@app.get("/api/config/defaults")
def get_defaults():
    """返回前端初始表单所需的默认参数与限制。"""
    return {
        "chunk_size": config.CHUNK_SIZE_DEFAULT,
        "chunk_overlap": config.CHUNK_OVERLAP_DEFAULT,
        "top_k": config.TOP_K_DEFAULT,
        "supported_extensions": list(rag_core.SUPPORTED_EXT),
        "max_upload_mb": MAX_UPLOAD_MB,
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
