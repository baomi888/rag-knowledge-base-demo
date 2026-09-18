# -*- coding: utf-8 -*-
"""
第八周作业 Demo：Agent 调用 RAG 知识库（ReAct 全链路）
=====================================================
主题：打通「用户提问 → Agent 自主判断 → 调用 RAG 检索工具 → 观察知识库片段
      → 结合片段生成最终回答」的完整闭环（ReAct 范式）。

复用第 5 周模块（本文件与其同级，直接 import，不重复造轮子）：
    rag_core.RagPipeline  —— 建库 / 检索（retrieve_with_score）
    config                —— LLM、Embedding、切片默认参数、文档清单

ReAct 闭环与本文件的对应关系：
    Thought(思考)   —— LLM 按 REACT_PROMPT 规定格式输出"要不要调工具、调哪个"
    Action(行动)    —— rag_search / rag_status 工具函数真正执行
    Observation(观察)—— 工具返回的字符串（片段列表 / 状态 / 友好错误）
    Final Answer    —— LLM 结合片段生成的最终中文回答（带依据编号）

依赖沿用第 5 周 requirements.txt：
    pip install -r requirements.txt

运行方式（在 rag-knowledge-base-demo 根目录）：
    python rag_agent.py
"""

import json
import os
import re
import sys

from typing_extensions import override

from langchain.agents import AgentExecutor, create_react_agent
from langchain_core.agents import AgentAction
from langchain_core.prompts import PromptTemplate
from langchain_core.tools import tool
from langchain.agents.react.agent import ReActSingleInputOutputParser

import config
from rag_core import RagPipeline, describe_api_error  # 建库/检索复用第 5 周模块

# ============================================================
# ① 集中配置区：切片/检索参数全部复用 config 默认值
# ============================================================
COLLECTION_NAME = "kb_main"          # 主知识库 collection 名
UPLOAD_DIR = "uploads"               # 第 7 周联网导入资料的存放目录
CHUNK_SIZE = config.CHUNK_SIZE_DEFAULT      # 切片大小（500）
CHUNK_OVERLAP = config.CHUNK_OVERLAP_DEFAULT  # 切片重叠（50）
TOP_K = config.TOP_K_DEFAULT                # 默认检索条数（3）
SNIPPET_MAX_LEN = 200        # 每条片段在 Observation 中截断长度（控制上下文）
MAX_DISTANCE = 1.1           # 相似度距离阈值：distance 越小越相关，超过视为"不相关"

# 对话模型配置：默认复用第 5 周 DeepSeek（rag_core.get_llm）。
# 若 DeepSeek 欠费，可在 .env 追加 AGENT_LLM_* 三项一键切换到其他 OpenAI 兼容服务
# （如阿里百炼 qwen-flash，实测有免费额度），无需改任何代码。
AGENT_LLM_BASE_URL = os.getenv("AGENT_LLM_BASE_URL", "")
AGENT_LLM_MODEL = os.getenv("AGENT_LLM_MODEL", "")
AGENT_LLM_API_KEY = os.getenv("AGENT_LLM_API_KEY", "")


def get_agent_llm():
    """返回 Agent 所用的对话 LLM：优先 AGENT_LLM_* 覆盖项，否则回退 rag_core.get_llm()。"""
    if AGENT_LLM_BASE_URL and AGENT_LLM_MODEL:
        from langchain_openai import ChatOpenAI
        return ChatOpenAI(
            api_key=AGENT_LLM_API_KEY or config.EMBEDDING_API_KEY,
            base_url=AGENT_LLM_BASE_URL,
            model=AGENT_LLM_MODEL,
            temperature=0.1,
        )
    from rag_core import get_llm
    return get_llm()

# 知识库单例：rag_search / rag_status 共用同一 kb_main 库（同参数不会重复建库）
_pipeline = RagPipeline(COLLECTION_NAME)


def _collect_paths() -> list:
    """组装建库文档清单：config.DEFAULT_FILES + uploads/ 下所有 txt/md。

    uploads/ 目录不存在或为空时直接跳过，绝不报错（作业明确要求）。
    """
    paths = list(config.DEFAULT_FILES)
    if os.path.isdir(UPLOAD_DIR) and os.listdir(UPLOAD_DIR):  # 目录存在且非空才加入
        for name in sorted(os.listdir(UPLOAD_DIR)):
            if name.lower().endswith((".txt", ".md")):
                paths.append(os.path.join(UPLOAD_DIR, name))
    return paths


# ============================================================
# ② 自定义工具（对应 ReAct 的 Action 行动环节）
#    @tool 装饰器；docstring 是给模型看的调用时机说明
# ============================================================

@tool
def rag_search(query: str, top_k: int = TOP_K) -> str:
    """RAG 知识库检索工具。当用户提出与知识库文档内容相关的问题（体育、天文科普、影视娱乐等资料主题）时调用本工具，检索知识库中最相关的片段。

    注意：
    - 本工具只做检索，返回知识库片段原文，不会生成答案；你需要结合片段自行组织最终回答。
    - 如果返回"知识库中未检索到相关内容"，说明资料不足，不要编造。

    Args:
        query: 检索问题或关键词，例如 "NBA是哪一年成立的"。
        top_k: 返回片段条数，默认 3。

    Returns:
        编号片段列表（来源文件、相似度距离、片段内容），或"未检索到"提示，或友好中文错误。
    """
    try:
        # —— 确保向量库就绪（首次运行自动建库，含 uploads/ 导入的资料）——
        n = _pipeline.get_or_build(CHUNK_SIZE, CHUNK_OVERLAP, paths=_collect_paths())
        if n == 0:
            return "错误：知识库为空（建库后片段数为 0），请检查 data/ 与 uploads/ 目录下是否有文档。"

        # —— 纯检索，绝不调用 LLM 生成答案 ——
        docs_scores = _pipeline.retrieve_with_score(query, top_k)
        if not docs_scores:
            return "知识库中未检索到相关内容。"

        # —— 格式化 Observation：编号 + 来源 + 页码 + 距离 + 片段内容 ——
        lines = [f"（知识库共 {n} 个片段，检索返回 {len(docs_scores)} 条）"]
        for i, (d, score) in enumerate(docs_scores, start=1):
            src = os.path.basename(d.metadata.get("source", "?"))
            page = d.metadata.get("page")
            loc = f" 第{page + 1}页" if page is not None else ""
            # distance 超过阈值视为不相关片段，明确标记，供 Agent 判断"资料不足"
            relevance = "" if score <= MAX_DISTANCE else "【与问题相关性低】"
            snippet = d.page_content.replace("\n", " ")[:SNIPPET_MAX_LEN]
            lines.append(f"[{i}] 来源：{src}{loc} ｜ distance={score:.3f}{relevance}\n{snippet}")
        return "\n\n".join(lines)
    except Exception as e:
        # 建库失败 / Embedding 接口异常等一律转友好中文错误，绝不抛异常给 Agent
        return f"检索工具出错：{describe_api_error(e)}"


@tool
def rag_status() -> str:
    """查询知识库状态：片段数量、就绪状态、data 与 uploads 目录下的文档主题列表。当用户询问"知识库里有什么内容 / 库里有哪些资料 / 知识库状态"时调用本工具。无需参数。"""
    try:
        # peek() 只查看磁盘上已有库，不触发建库（状态查询不该耗时几十秒）
        n = _pipeline.peek()
        ready = "已就绪" if n > 0 else "尚未构建（首次提问检索时会自动构建）"

        def _topics(d: str) -> str:
            if not os.path.isdir(d):
                return "（目录不存在）"
            files = [f for f in sorted(os.listdir(d)) if f.lower().endswith((".txt", ".md", ".pdf"))]
            return "、".join(files) if files else "（无文档）"

        return (
            f"知识库状态：\n"
            f"- collection：{COLLECTION_NAME}\n"
            f"- 片段数量：{n} 个\n"
            f"- 就绪状态：{ready}\n"
            f"- data/ 目录文档（本地示例）：{_topics('data')}\n"
            f"- uploads/ 目录文档（联网导入）：{_topics(UPLOAD_DIR)}"
        )
    except Exception as e:
        return f"状态查询出错：{describe_api_error(e)}"


TOOLS = [rag_search, rag_status]

# ============================================================
# ③ ReAct 提示词（规定 Thought → Action → Observation → Final Answer 格式）
# ============================================================
REACT_PROMPT = PromptTemplate.from_template(
    """你是一个"知识库问答助手"（RAG Agent），只回答知识库内文档相关问题，用中文作答。

你可以使用以下工具：
{tools}

请严格按照下面的 ReAct 格式推理（每轮只输出一个动作）：

Question: 用户的问题
Thought: 思考该问题是否需要查知识库、该调用哪个工具
Action: 动作名，只能是 [{tool_names}] 之一；若无需工具则不出现 Action
Action Input: 工具输入，必须是合法 JSON（无参数工具填 {{}}），例如："query": "NBA是哪一年成立的"
Observation: 工具返回的片段或状态信息
（Thought / Action / Action Input / Observation 可重复多轮）
Thought: 我已掌握足够信息，可以回答了
Final Answer: 给用户的最终中文回答

行为准则：
1. 除闲聊、打招呼、身份提问之外的一切知识类问题（包括天气、新闻、生活常识等不确定知识库是否包含的主题），都必须先调用 rag_search 检索验证，用 Observation 判断知识库中是否存在相关内容，不要凭自己的知识直接回答。
2. 询问知识库里有什么/状态类问题：调用 rag_status。
3. 拿到片段后【只依据片段内容】生成回答，绝不使用资料之外的知识，绝不编造；回答末尾注明依据编号，例如（依据：[1][3]）。
4. 如果 Observation 是"未检索到相关内容"、所有片段都标记"相关性低"、或片段内容不足以回答问题：直接回答「资料不足，无法从知识库中找到相关内容。」，不要强行作答。
5. 闲聊、打招呼、身份提问：不调用任何工具，声明"我只回答知识库内文档相关问题"，并引导用户提问。
6. Final Answer 必须是通顺自然的中文。

现在开始！

Question: {input}
Thought:{agent_scratchpad}"""
)


# ============================================================
# ④ 自定义 ReAct 解析器（参照第 7 周 main.py 的 ReActJsonArgsOutputParser）
#    经典 ReAct 解析器把 Action Input 当作单个字符串；本类把 JSON 字符串
#    解析成 dict，从而按具名参数绑定到多参数工具（query/top_k）
# ============================================================
class ReActJsonArgsOutputParser(ReActSingleInputOutputParser):
    """支持 JSON 多参数 Action Input 的 ReAct 解析器。"""

    _FENCE_RE = re.compile(r"^\s*```(?:json)?|```\s*$", re.IGNORECASE)

    @override
    def parse(self, text: str):
        result = super().parse(text)   # 先走经典解析：得到 AgentAction 或 AgentFinish

        # Final Answer 无需处理；只给"行动"补 JSON 解析
        if not isinstance(result, AgentAction) or not isinstance(result.tool_input, str):
            return result

        raw = result.tool_input.strip()
        raw = self._FENCE_RE.sub("", raw).strip()  # 容错：剥掉模型可能输出的 ```json 围栏

        # 只有长得像 JSON 对象时才解析；普通字符串原样保留（向后兼容单参工具）
        if raw.startswith("{") and raw.endswith("}"):
            try:
                parsed = json.loads(raw)
            except json.JSONDecodeError:
                return result  # JSON 非法时保留原样，交给错误回灌机制自我修正
            if isinstance(parsed, dict):
                return AgentAction(
                    tool=result.tool,
                    tool_input=parsed,   # dict -> 按具名参数绑定到工具函数
                    log=result.log,
                )
        return result


# ============================================================
# ⑤ 组装 ReAct Agent：LLM(复用config) + 工具 + 提示词 -> 执行器(verbose)
# ============================================================
def build_agent_executor() -> AgentExecutor:
    llm = get_agent_llm()  # 优先 .env 的 AGENT_LLM_*，默认回退第 5 周 DeepSeek

    react_agent = create_react_agent(
        llm=llm,
        tools=TOOLS,
        prompt=REACT_PROMPT,
        output_parser=ReActJsonArgsOutputParser(),  # 注入多参数 JSON 解析器
    )

    # AgentExecutor 驱动完整闭环；verbose=True 打印每一步 Thought/Action/Observation
    return AgentExecutor(
        agent=react_agent,
        tools=TOOLS,
        verbose=True,
        handle_parsing_errors=True,  # 格式偶发不规范时回灌错误让其自我修正
        max_iterations=5,            # 防止异常情况下无限循环
    )


# ============================================================
# ⑥ 测试用例：覆盖 检索成功 / 检索无结果拒答 / 不调用工具 三条路径
# ============================================================
TEST_CASES = [
    ("NBA是哪一年成立的？", "调 rag_search，结合 nba.txt 片段回答并注明依据编号"),
    ("介绍一下黑洞", "调 rag_search，天文科普主题，依据 science.txt 片段介绍"),
    ("今天天气怎么样？", "调 rag_search，无相关片段 → 拒答：资料不足，无法从知识库中找到相关内容"),
    ("知识库里有什么内容？", "调 rag_status，报告片段数与 data/uploads 文档清单"),
    ("你好，你是谁？", "不调用工具，声明职责边界并引导提问"),
]


if __name__ == "__main__":
    # 启动前校验配置（.env 中 DEEPSEEK_API_KEY / EMBEDDING_API_KEY 等）
    missing = config.validate()
    if missing:
        print("配置缺失，请先在 .env 中补齐：")
        for m in missing:
            print(" -", m)
        sys.exit(1)

    executor = build_agent_executor()

    for idx, (question, expect) in enumerate(TEST_CASES, start=1):
        print("\n" + "=" * 70)
        print(f"测试用例 {idx}/{len(TEST_CASES)}：{question}")
        print(f"预期路径：{expect}")
        print("-" * 70)
        try:
            # invoke 一次完整 ReAct 循环；verbose 日志可见
            # Thought(思考) -> Action(rag_search) -> Observation(片段) -> Final Answer(带依据)
            output = executor.invoke({"input": question})
            print(f"\n>>> 最终回答：{output['output']}")
        except Exception as exc:  # 单条失败不影响后续用例
            print(f"\n>>> 该用例运行出错：{exc}")
