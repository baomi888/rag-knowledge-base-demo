# -*- coding: utf-8 -*-
"""
Demo5 · 控制台 RAG 问答（第5周）

全链路：文档加载(txt/PDF) → RecursiveCharacterTextSplitter 切片 → Embedding 向量化
        → Chroma 本地持久化入库 → top-k 相似度检索 → 组装 RAG 提示词 → 调用 DeepSeek 大模型问答
交互：控制台循环问答，输入 quit / exit 退出
说明：本周仅控制台版本，不含任何网页 UI（Gradio 等属于第6周任务）

运行：python rag_console.py             # 首次运行自动构建向量库，之后直接问答
      python rag_console.py --rebuild   # 强制清空并重建向量库
"""

import os
import shutil
import sys

import openai
from chromadb.config import Settings
from dotenv import load_dotenv
from langchain_chroma import Chroma
from langchain_community.document_loaders import TextLoader
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI, OpenAIEmbeddings
from langchain_text_splitters import RecursiveCharacterTextSplitter

# ---------- 可调参数 ----------
CHUNK_SIZE = 500        # 每个 chunk 的最大长度（字符）
CHUNK_OVERLAP = 50      # 相邻 chunk 的重叠长度
TOP_K = 4               # 默认检索条数（top-k），可在交互中输入 "topk N" 动态修改
PERSIST_DIR = "chroma_db"          # Chroma 本地持久化目录（已加入 .gitignore）
COLLECTION_NAME = "rag_kb"         # 固定集合名，保证多次运行指向同一个库
DEFAULT_FILES = [os.path.join("data", "sample.txt"), os.path.join("data", "test.pdf")]
SUPPORTED_EXT = (".txt", ".pdf")
EMBED_BATCH_SIZE = 10              # Embedding 接口单次批量上限（阿里百炼限制为10，硅基流动32）

# RAG 系统提示词：约束模型仅依据参考资料回答，资料不足时明确说明
SYSTEM_PROMPT = """你是一个严谨的问答助手，必须遵守以下规则：
1. 仅依据【参考资料】回答用户问题，不得使用资料之外的任何知识；
2. 回答末尾注明依据的片段编号，例如（依据：[1][3]）；
3. 如果参考资料不足以回答问题，直接回答：「资料不足，无法从知识库中找到相关内容。」
4. 用中文简洁作答，不要编造任何资料中没有的信息。"""


def describe_api_error(e: Exception) -> str:
    """把 openai SDK 的各类网络/接口异常翻译成中文提示。"""
    if isinstance(e, openai.AuthenticationError):
        return ("401 认证失败：密钥无效。注意 DeepSeek 官方 Key 与硅基流动 Key "
                "分属两个平台，请确认各接口使用对应的 Key 与 BASE_URL")
    if isinstance(e, openai.APIConnectionError):
        return "网络连接失败：请检查本机网络/代理，以及 DEEPSEEK_BASE_URL、EMBEDDING_BASE_URL 是否正确"
    if isinstance(e, openai.RateLimitError):
        return "429 请求受限：请求过于频繁或账户额度不足，请稍后再试"
    if isinstance(e, openai.APIStatusError):
        if e.status_code == 402:
            return ("402 余额不足：请到对应平台充值（注意：硅基流动在余额≤0时"
                    "连免费模型也会拒绝调用）")
        return f"接口返回错误 {e.status_code}：{e.message}"
    return f"{type(e).__name__}: {e}"


def load_document(file_path: str):
    """加载单个 txt/PDF 文档，返回 LangChain Document 列表。"""
    if not os.path.exists(file_path):
        # 异常1：文件不存在
        raise FileNotFoundError(f"文件不存在：{file_path}")

    ext = os.path.splitext(file_path)[1].lower()
    if ext not in SUPPORTED_EXT:
        # 异常2：格式不支持
        raise ValueError(f"不支持的文档格式：'{ext}'（仅支持 {'、'.join(SUPPORTED_EXT)}）")

    if ext == ".txt":
        try:
            docs = TextLoader(file_path, encoding="utf-8").load()
        except UnicodeDecodeError:
            # Windows 记事本可能是 GBK 编码，做一次兜底
            docs = TextLoader(file_path, encoding="gbk").load()
    else:  # .pdf
        from langchain_community.document_loaders import PyPDFLoader
        docs = PyPDFLoader(file_path).load()
    return docs


def load_documents(paths: list):
    """批量加载文档；全部缺失则抛出 FileNotFoundError。"""
    all_docs = []
    for p in paths:
        all_docs.extend(load_document(p))
        print(f"  ✓ 已加载：{p}")
    return all_docs


def split_documents(docs: list) -> list:
    """RecursiveCharacterTextSplitter 切片（与 Demo4 保持一致）。"""
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=CHUNK_SIZE,
        chunk_overlap=CHUNK_OVERLAP,
        separators=["\n\n", "\n", "。", "！", "？", "；", "，", " ", ""],
        length_function=len,
    )
    return splitter.split_documents(docs)


def build_vectorstore(embeddings, paths: list, force_rebuild: bool) -> Chroma:
    """构建或加载 Chroma 持久化向量库。"""
    if force_rebuild and os.path.exists(PERSIST_DIR):
        shutil.rmtree(PERSIST_DIR)  # 重建前清空旧库，避免重复入库
        print(f"已清空旧向量库：{PERSIST_DIR}")

    vectorstore = Chroma(
        persist_directory=PERSIST_DIR,
        embedding_function=embeddings,
        collection_name=COLLECTION_NAME,
        # 关闭匿名遥测上报，保持控制台输出干净
        client_settings=Settings(anonymized_telemetry=False),
    )
    count = vectorstore._collection.count()  # 集合内已有片段数

    if count > 0 and not force_rebuild:
        # 已有库存：直接复用，跳过重新 Embedding（省时省钱）
        print(f"检测到已有向量库（{count} 个片段），直接复用。如需重建：python rag_console.py --rebuild")
        return vectorstore

    print("\n[建库] 加载文档 → 切片 → 向量化 → 写入 Chroma ...")
    docs = load_documents(paths)
    chunks = split_documents(docs)
    if not chunks:
        raise ValueError("切片结果为空，请检查文档内容")

    # 分批入库，避免超出 Embedding 接口单次批量限制
    for i in range(0, len(chunks), EMBED_BATCH_SIZE):
        batch = chunks[i : i + EMBED_BATCH_SIZE]
        vectorstore.add_documents(batch)
        print(f"  ✓ 入库 {min(i + EMBED_BATCH_SIZE, len(chunks))}/{len(chunks)} 个片段")

    print(f"[建库] 完成：共 {len(chunks)} 个片段持久化到 {PERSIST_DIR}/")
    return vectorstore


def answer_question(vectorstore: Chroma, llm, question: str, top_k: int) -> str:
    """检索 + 组装 RAG 提示词 + 调用大模型，返回回答文本。"""
    # 1. top-k 相似度检索
    docs = vectorstore.similarity_search(question, k=top_k)
    if not docs:
        return "知识库中没有可用内容，请先构建向量库。"

    # 2. 打印检索到的片段来源（可与 DSP-desktop 的检索结果对照）
    print(f"\n[检索] 命中 top-{len(docs)} 片段：")
    for i, d in enumerate(docs):
        src = d.metadata.get("source", "?")
        page = d.metadata.get("page", "")
        loc = f" 第{page + 1}页" if page != "" else ""
        preview = d.page_content.replace("\n", " ")[:40]
        print(f"  [{i + 1}] {os.path.basename(src)}{loc} | {preview}...")

    # 3. 组装 RAG 提示词：参考资料 + 用户问题
    references = "\n\n".join(
        f"[{i + 1}] （来源：{d.metadata.get('source', '?')}）\n{d.page_content}"
        for i, d in enumerate(docs)
    )
    user_prompt = f"【参考资料】\n{references}\n\n【用户问题】\n{question}"

    # 4. 调用 DeepSeek 大模型生成回答
    response = llm.invoke([SystemMessage(content=SYSTEM_PROMPT), HumanMessage(content=user_prompt)])
    return response.content


def main():
    # Windows 控制台中文输出兜底
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

    print("=" * 56)
    print(" Demo5 · 控制台 RAG 问答（第5周）")
    print(" 退出：输入 quit 或 exit | 调整检索条数：输入 topk 4")
    print("=" * 56)

    # ---------- 1. 读取环境变量 ----------
    load_dotenv()
    llm_key = os.getenv("DEEPSEEK_API_KEY")
    llm_base = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
    llm_model = os.getenv("DEEPSEEK_MODEL", "deepseek-chat")
    # 向量服务密钥未单独配置时，复用 DEEPSEEK_API_KEY（同一平台双模型时适用）
    embed_key = os.getenv("EMBEDDING_API_KEY", llm_key)
    embed_base = os.getenv("EMBEDDING_BASE_URL")
    embed_model = os.getenv("EMBEDDING_MODEL", "BAAI/bge-m3")

    if not llm_key:
        # 异常3：密钥缺失
        raise ValueError("缺少 DEEPSEEK_API_KEY：请在 .env 中配置（参考 .env.example）")
    if not embed_base:
        raise ValueError("缺少 EMBEDDING_BASE_URL：请在 .env 中填写向量服务地址")

    # ---------- 2. 初始化两个模型客户端 ----------
    llm = ChatOpenAI(
        api_key=llm_key,
        base_url=llm_base,
        model=llm_model,
        temperature=0.1,  # 问答场景调低随机性
    )
    embeddings = OpenAIEmbeddings(
        api_key=embed_key,
        base_url=embed_base,
        model=embed_model,
        check_embedding_ctx_length=False,  # 第三方兼容接口关闭 token 检查
    )

    # ---------- 3. 构建或加载向量库 ----------
    force_rebuild = "--rebuild" in sys.argv
    paths = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not paths:
        paths = DEFAULT_FILES
    try:
        vectorstore = build_vectorstore(embeddings, paths, force_rebuild)
    except openai.OpenAIError as e:
        # 异常4：建库阶段的网络/接口异常
        print(f"\n[错误] 建库失败：{describe_api_error(e)}")
        sys.exit(1)

    # ---------- 4. 控制台循环问答 ----------
    top_k = TOP_K
    while True:
        try:
            question = input("\n你> ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\n再见！")
            break

        if not question:
            continue
        if question.lower() in ("quit", "exit"):
            print("再见！")
            break
        if question.lower().startswith("topk"):
            parts = question.split()
            if len(parts) == 2 and parts[1].isdigit() and int(parts[1]) > 0:
                top_k = int(parts[1])
                print(f"已将检索条数 top-k 修改为 {top_k}")
            else:
                print("用法：topk 4")
            continue

        try:
            answer = answer_question(vectorstore, llm, question, top_k)
            print(f"\n助手> {answer}")
        except openai.OpenAIError as e:
            # 异常5：问答阶段的网络/接口异常，不退出程序，继续下一轮
            print(f"\n[错误] 调用失败：{describe_api_error(e)}")
            print("（可继续提问，或输入 quit 退出）")


if __name__ == "__main__":
    try:
        main()
    except (FileNotFoundError, ValueError) as e:
        print(f"\n[错误] {e}")
        sys.exit(1)
    except ImportError as e:
        print(f"\n[错误] 依赖缺失：{e}\n请先执行：pip install -r requirements.txt")
        sys.exit(1)
    except Exception as e:
        print(f"\n[未知错误] {type(e).__name__}: {e}")
        sys.exit(1)
