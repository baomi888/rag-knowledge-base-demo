# -*- coding: utf-8 -*-
"""
Demo4 · RAG 知识库预处理（第4周）

链路：加载本地 txt/PDF -> RecursiveCharacterTextSplitter 切片 -> 调用 Embedding 接口生成向量 -> 控制台打印预览
范围：本周只做预处理；Chroma 入库、Prompt 组装、RAG 问答属于第5周任务。
运行：python preprocess.py [文档路径]   不传参数时默认处理 data/sample.txt
"""

import os
import sys

from dotenv import load_dotenv
from langchain_community.document_loaders import TextLoader
from langchain_openai import OpenAIEmbeddings
from langchain_text_splitters import RecursiveCharacterTextSplitter

# ---------- 可调参数 ----------
CHUNK_SIZE = 500        # 每个 chunk 的最大长度（按字符数）
CHUNK_OVERLAP = 50      # 相邻 chunk 的重叠长度，避免句子被切断丢失语义
PRINT_PREVIEW_NUM = 3   # 控制台只预览前 N 个 chunk（不打印完整长向量）
EMBED_BATCH_SIZE = 32   # Embedding 接口单次请求的批量上限（部分服务有批量限制）
DEFAULT_FILE = os.path.join("data", "sample.txt")  # 未传参数时的默认文档
SUPPORTED_EXT = (".txt", ".pdf")                   # Demo4 支持的文档格式


def load_document(file_path: str):
    """根据扩展名加载文档，返回 LangChain Document 列表。"""
    if not os.path.exists(file_path):
        # 异常1：文件不存在
        raise FileNotFoundError(
            f"文件不存在：{file_path}\n请检查路径是否正确，或把文档放到 data/ 目录下。"
        )

    ext = os.path.splitext(file_path)[1].lower()
    if ext not in SUPPORTED_EXT:
        # 异常2：格式不支持
        raise ValueError(
            f"不支持的文档格式：'{ext}'（当前仅支持 {'、'.join(SUPPORTED_EXT)}）"
        )

    if ext == ".txt":
        try:
            docs = TextLoader(file_path, encoding="utf-8").load()
        except UnicodeDecodeError:
            # Windows 记事本保存的文件可能是 GBK 编码，做一次兜底
            docs = TextLoader(file_path, encoding="gbk").load()
    else:  # .pdf
        try:
            # 延迟导入：未安装 pypdf 时不影响纯 txt 流程
            from langchain_community.document_loaders import PyPDFLoader
        except ImportError:
            raise ImportError("读取 PDF 需要先安装 pypdf：pip install pypdf")
        docs = PyPDFLoader(file_path).load()

    return docs


def build_embeddings(api_key: str, base_url: str, model: str) -> OpenAIEmbeddings:
    """构造 Embedding 客户端（OpenAI 兼容接口）。"""
    return OpenAIEmbeddings(
        api_key=api_key,
        base_url=base_url,
        model=model,
        # 非 OpenAI 官方接口时关闭 token 长度检查，直接发送原始文本，
        # 避免内部 tiktoken 分词在第三方兼容服务上引起报错
        check_embedding_ctx_length=False,
    )


def embed_texts(embeddings: OpenAIEmbeddings, texts: list) -> list:
    """分批调用 Embedding 接口，返回每个 chunk 对应的向量列表。"""
    vectors = []
    for i in range(0, len(texts), EMBED_BATCH_SIZE):
        batch = texts[i : i + EMBED_BATCH_SIZE]
        vectors.extend(embeddings.embed_documents(batch))
    return vectors


def main():
    # Windows 控制台中文输出兜底（避免 GBK 编码报错）
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

    print("=" * 56)
    print(" Demo4 · RAG 预处理：文档加载 → 文本切片 → 向量化")
    print("=" * 56)

    # ---------- 1. 读取环境变量 ----------
    load_dotenv()
    api_key = os.getenv("DEEPSEEK_API_KEY")
    base_url = os.getenv("EMBEDDING_BASE_URL")
    model = os.getenv("EMBEDDING_MODEL", "BAAI/bge-m3")

    if not api_key:
        # 异常3：密钥缺失
        raise ValueError("缺少 DEEPSEEK_API_KEY：请在 .env 文件中配置（参考 .env.example）")
    if not base_url:
        raise ValueError("缺少 EMBEDDING_BASE_URL：请在 .env 中填写 Embedding 服务地址")

    # ---------- 2. 加载文档 ----------
    file_path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_FILE
    docs = load_document(file_path)
    total_chars = sum(len(d.page_content) for d in docs)
    if total_chars == 0:
        raise ValueError(f"文档内容为空，无法处理：{file_path}")
    print(f"\n[1/3] 文档加载成功：{file_path}")
    print(f"      共 {len(docs)} 个文档对象，正文总计 {total_chars} 字符")

    # ---------- 3. 文本切片 ----------
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=CHUNK_SIZE,
        chunk_overlap=CHUNK_OVERLAP,
        # 中文文档优先按段落、换行、句号等自然边界切分
        separators=["\n\n", "\n", "。", "！", "？", "；", "，", " ", ""],
        length_function=len,
    )
    chunks = splitter.split_documents(docs)
    print(f"\n[2/3] 切片完成：chunk_size={CHUNK_SIZE}, chunk_overlap={CHUNK_OVERLAP}")
    print(f"      共生成 {len(chunks)} 个 chunk")

    # ---------- 4. 调用 Embedding 生成向量 ----------
    print(f"\n[3/3] 调用 Embedding 接口生成向量（model={model}）...")
    embeddings = build_embeddings(api_key, base_url, model)
    texts = [c.page_content for c in chunks]
    vectors = embed_texts(embeddings, texts)

    # ---------- 5. 打印预览（只看部分维度，不打印完整长向量） ----------
    show_num = min(PRINT_PREVIEW_NUM, len(chunks))
    print("\n" + "-" * 56)
    print(f" Chunk 预览（共 {len(chunks)} 个，仅展示前 {show_num} 个）")
    print("-" * 56)
    for idx in range(show_num):
        preview = chunks[idx].page_content.replace("\n", " ")[:60]
        dims = len(vectors[idx])
        head = ", ".join(f"{v:.4f}" for v in vectors[idx][:5])
        print(f"[Chunk {idx}] 向量维度={dims} | 前5维=[{head}, ...]")
        print(f"           文本预览: {preview}...")

    print("\n✅ 预处理完成！可把上述向量复制到 DSP-desktop 观察向量效果。")
    print("   （第5周将把这些向量存入 Chroma，并接入 RAG 问答）")


if __name__ == "__main__":
    try:
        main()
    except (FileNotFoundError, ValueError) as e:
        print(f"\n[错误] {e}")
        sys.exit(1)
    except ImportError as e:
        print(f"\n[错误] 依赖缺失：{e}\n请先执行：pip install -r requirements.txt")
        sys.exit(1)
    except AuthenticationError:
        # 401：密钥无效，常见原因是拿 DeepSeek 官方 Key 去调第三方 Embedding 服务
        print("\n[错误] Embedding 接口认证失败（401）：密钥无效。")
        print("       注意：DeepSeek 官方 Key 无法调用 Embedding 服务，")
        print("       请到 EMBEDDING_BASE_URL 对应平台（如硅基流动 cloud.siliconflow.cn）")
        print("       重新生成 API 密钥，并更新 .env 后重试。")
        sys.exit(1)
    except Exception as e:
        print(f"\n[未知错误] {type(e).__name__}: {e}")
        sys.exit(1)
