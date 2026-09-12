# -*- coding: utf-8 -*-
"""
Demo6 · RAG 核心逻辑（与界面完全分离，可被 app.py / 后续项目复用）

职责：文档加载 → 切片 → Embedding 向量化 → Chroma 持久化 → top-k 检索 → RAG 提示词组装 → 调用大模型
不含任何 Gradio / 界面代码。
"""

import os

import chromadb
import openai
from langchain_chroma import Chroma
from langchain_community.document_loaders import TextLoader
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI, OpenAIEmbeddings
from langchain_text_splitters import RecursiveCharacterTextSplitter

import config

SUPPORTED_EXT = (".txt", ".md", ".pdf")  # .md 按纯文本加载，Markdown 语法不影响切片

# RAG 系统提示词：仅依据参考资料回答，资料不足时明确拒答
SYSTEM_PROMPT = """你是一个严谨的问答助手，必须遵守以下规则：
1. 仅依据【参考资料】回答用户问题，不得使用资料之外的任何知识；
2. 回答末尾注明依据的片段编号，例如（依据：[1][3]）；
3. 如果参考资料不足以回答问题，直接回答：「资料不足，无法从知识库中找到相关内容。」
4. 用中文简洁作答，不要编造任何资料中没有的信息；
5. 如果用户输入的是词语或短语（而非完整问题），则根据参考资料围绕该主题做简要介绍。"""


def describe_api_error(e: Exception) -> str:
    """把 openai SDK 异常翻译成中文提示。"""
    if isinstance(e, openai.AuthenticationError):
        return "401 认证失败：密钥无效，请检查 .env 中各接口对应的 Key 与 BASE_URL"
    if isinstance(e, openai.APIConnectionError):
        return "网络连接失败：请检查网络/代理以及各 BASE_URL 配置"
    if isinstance(e, openai.RateLimitError):
        return "429 请求受限：请求过于频繁或额度不足，请稍后再试"
    if isinstance(e, openai.APIStatusError):
        if e.status_code == 402:
            return "402 余额不足：请到对应平台充值"
        return f"接口返回错误 {e.status_code}：{e.message}"
    return f"{type(e).__name__}: {e}"


def load_document(file_path: str):
    """加载单个 txt/PDF 文档，返回 Document 列表。"""
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"文件不存在：{file_path}")
    ext = os.path.splitext(file_path)[1].lower()
    if ext not in SUPPORTED_EXT:
        raise ValueError(f"不支持的文档格式：'{ext}'（仅支持 txt/pdf）")
    if ext == ".txt":
        try:
            return TextLoader(file_path, encoding="utf-8").load()
        except UnicodeDecodeError:
            return TextLoader(file_path, encoding="gbk").load()  # Windows 记事本兜底
    from langchain_community.document_loaders import PyPDFLoader
    return PyPDFLoader(file_path).load()


def load_documents(paths=None):
    """批量加载文档（默认 data/ 下全部支持格式），返回 Document 列表。"""
    paths = paths or config.DEFAULT_FILES
    all_docs = []
    for p in paths:
        all_docs.extend(load_document(p))
    return all_docs


def split_documents(docs, chunk_size: int, chunk_overlap: int):
    """RecursiveCharacterTextSplitter 切片（与 Demo4/5 保持一致）。"""
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
        separators=["\n\n", "\n", "。", "！", "？", "；", "，", " ", ""],
        length_function=len,
    )
    return splitter.split_documents(docs)


def get_embeddings() -> OpenAIEmbeddings:
    """向量化客户端（OpenAI 兼容接口）。"""
    return OpenAIEmbeddings(
        api_key=config.EMBEDDING_API_KEY,
        base_url=config.EMBEDDING_BASE_URL,
        model=config.EMBEDDING_MODEL,
        check_embedding_ctx_length=False,  # 第三方兼容接口关闭 token 检查
    )


def get_llm() -> ChatOpenAI:
    """大模型对话客户端（DeepSeek）。"""
    return ChatOpenAI(
        api_key=config.DEEPSEEK_API_KEY,
        base_url=config.DEEPSEEK_BASE_URL,
        model=config.DEEPSEEK_MODEL,
        temperature=0.1,
    )


class RagPipeline:
    """单条 RAG 链路。左右两栏各实例化一个，用不同 collection 名隔离向量库。"""

    def __init__(self, collection_name: str):
        self.collection_name = collection_name  # 如 kb_left / kb_right
        self._vs = None          # Chroma 实例缓存
        self._params = None      # 当前库对应的 (chunk_size, chunk_overlap)

    # ---------- 建库 ----------
    def build_index(self, chunk_size: int, chunk_overlap: int, paths=None) -> int:
        """按新切片参数重建向量库，返回片段数。"""
        # 删除旧 collection，保证参数变更后完全重建
        client = chromadb.PersistentClient(path=config.PERSIST_DIR)
        try:
            client.delete_collection(self.collection_name)
        except Exception:
            pass  # 首次不存在时忽略

        docs = load_documents(paths)
        chunks = split_documents(docs, chunk_size, chunk_overlap)
        if not chunks:
            raise ValueError("切片结果为空，请检查文档内容与切片参数")

        self._vs = Chroma(
            persist_directory=config.PERSIST_DIR,
            embedding_function=get_embeddings(),
            collection_name=self.collection_name,
        )
        # 分批入库，避免超出 Embedding 接口单次批量限制
        for i in range(0, len(chunks), config.EMBED_BATCH_SIZE):
            self._vs.add_documents(chunks[i : i + config.EMBED_BATCH_SIZE])

        self._params = (chunk_size, chunk_overlap)
        return len(chunks)

    def get_or_build(self, chunk_size: int, chunk_overlap: int, paths=None) -> int:
        """确保向量库就绪：未建或参数变化则自动重建，返回片段数。"""
        if self._vs is None or self._params != (chunk_size, chunk_overlap):
            return self.build_index(chunk_size, chunk_overlap, paths)
        return self.count()

    def count(self) -> int:
        """当前库内片段数。"""
        return self._vs._collection.count() if self._vs else 0

    def peek(self) -> int:
        """不建库的前提下查看磁盘上已有库的片段数（用于页面初始状态）。"""
        try:
            client = chromadb.PersistentClient(path=config.PERSIST_DIR)
            col = client.get_collection(self.collection_name)
            return col.count()
        except Exception:
            return 0  # 库不存在

    # ---------- 检索 + 问答 ----------
    def retrieve_with_score(self, question: str, top_k: int):
        """top-k 相似度检索，返回 (Document, distance) 列表；distance 越小越相关。"""
        return self._vs.similarity_search_with_score(question, k=top_k)

    @staticmethod
    def _format_refs(docs_scores):
        """参考片段 Markdown：来源 + 页码 + 相似度距离 + 片段预览（等宽字体区展示）。"""
        lines = []
        for i, (d, score) in enumerate(docs_scores):
            src = os.path.basename(d.metadata.get("source", "?"))
            page = d.metadata.get("page")
            loc = f" 第{page + 1}页" if page is not None else ""
            preview = d.page_content.replace("\n", " ")[:60]
            lines.append(f"**[{i + 1}]** {src}{loc} ｜ score={score:.3f} ｜ {preview}...")
        return "\n\n".join(lines) if lines else "（无检索结果）"

    def answer(self, question: str, top_k: int):
        """检索 → 组装 RAG 提示词 → 调用大模型（同步，用于对比区）。返回 (答案, 参考片段Markdown)。"""
        if not self._vs or self.count() == 0:
            raise RuntimeError("知识库为空：请先点击「重新构建索引」或输入问题触发自动建库")

        docs_scores = self.retrieve_with_score(question, top_k)
        if not docs_scores:
            return "知识库中未检索到相关内容。", "（无检索结果）"
        refs_md = self._format_refs(docs_scores)

        references = "\n\n".join(
            f"[{i + 1}] （来源：{d.metadata.get('source', '?')}）\n{d.page_content}"
            for i, (d, _) in enumerate(docs_scores)
        )
        user_prompt = f"【参考资料】\n{references}\n\n【用户问题】\n{question}"

        response = get_llm().invoke(
            [SystemMessage(content=SYSTEM_PROMPT), HumanMessage(content=user_prompt)]
        )
        return response.content, refs_md

    def answer_stream(self, question: str, top_k: int):
        """流式问答生成器：yield (累计答案文本, 参考片段Markdown)。

        检索完成后先输出参考片段，随后大模型逐字输出（打字机效果）。
        """
        if not self._vs or self.count() == 0:
            raise RuntimeError("知识库为空：请先点击「重新构建索引」或输入问题触发自动建库")

        docs_scores = self.retrieve_with_score(question, top_k)
        if not docs_scores:
            yield "知识库中未检索到相关内容。", "（无检索结果）"
            return
        refs_md = self._format_refs(docs_scores)
        yield "", refs_md  # 先展示检索来源

        references = "\n\n".join(
            f"[{i + 1}] （来源：{d.metadata.get('source', '?')}）\n{d.page_content}"
            for i, (d, _) in enumerate(docs_scores)
        )
        user_prompt = f"【参考资料】\n{references}\n\n【用户问题】\n{question}"

        acc = ""
        for chunk in get_llm().stream(
            [SystemMessage(content=SYSTEM_PROMPT), HumanMessage(content=user_prompt)]
        ):
            acc += chunk.content or ""
            yield acc, refs_md
