FROM python:3.13-slim

WORKDIR /app

# 安装编译依赖（chromadb 需要）
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# 先装依赖（利用 Docker 缓存）
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 复制核心模块与后端代码
COPY rag_core.py config.py ./
COPY backend/ ./backend/

# 复制数据目录
COPY data/ ./data/

# 确保上传目录存在
RUN mkdir -p /app/data/uploads

WORKDIR /app/backend

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
