<div align="center">

# 🎓 RAG Knowledge Base

**基于 LangChain + Chroma + DeepSeek 的检索增强生成（RAG）知识库系统**

从预处理脚本到生产级 Web 应用的完整演进：控制台 → 前后端分离 · SSE 流式 · 多知识库 · 参数对比 · 联网资料导入

![Python](https://img.shields.io/badge/Python-3.10+-3776AB?logo=python&logoColor=white)
![LangChain](https://img.shields.io/badge/LangChain-0.3.x-1C3C3C?logo=langchain&logoColor=white)
![Chroma](https://img.shields.io/badge/Chroma-Vector_DB-FF6F3C)
![FastAPI](https://img.shields.io/badge/FastAPI-Backend-009688?logo=fastapi&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-14-black?logo=next.js&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-green)

</div>

---

## 📖 项目简介

本项目是一个课程驱动的 RAG（Retrieval-Augmented Generation）系统实践，按周迭代出三个形态，共享同一套 RAG 核心逻辑：

| 形态 | 入口 | 适用场景 |
|---|---|---|
| **预处理脚本** | `preprocess.py` | 理解切片/向量化原理，观察向量输出 |
| **控制台问答** | `rag_console.py` | 快速验证检索与提示词约束 |
| **Web 应用** | `backend/` + `frontend/` | 完整产品体验：流式问答、参数实验、多知识库管理、联网资料导入 |

### 系统架构

```
                        ┌─────────────────────────────────────┐
                        │           Web Frontend              │
                        │  Next.js 14 · TypeScript · shadcn   │
                        │  SSE 流式渲染 · 参数面板 · 对比模式   │
                        └──────────────┬──────────────────────┘
                                       │ REST / SSE
                        ┌──────────────▼──────────────────────┐
                        │            FastAPI Backend          │
                        │   main / index / chat / compare     │
                        ├─────────────────────────────────────┤
                        │           rag_core (共享核心)        │
                        │  Load → Split → Embed → Retrieve    │
                        │        → Prompt → LLM Answer        │
                        └───────┬──────────────────┬──────────┘
                                │                  │
                     ┌──────────▼──────┐  ┌────────▼─────────┐
                     │ Chroma 持久向量库 │  │  OpenAI 兼容 API  │
                     │  main/left/right │  │  DeepSeek (LLM)  │
                     │  HNSW 索引       │  │  百炼 (Embedding) │
                     └─────────────────┘  └──────────────────┘
```

## ✨ 核心特性

- **🔍 全链路 RAG**：文档加载（txt/md/pdf）→ 递归字符切片 → 向量化 → Chroma 持久化 → top-k 检索 → 提示词组装 → LLM 生成
- **🌊 SSE 流式问答**：逐字渲染，支持发送中中断（客户端断开自动终止生成）
- **🧪 参数实验平台**：chunk_size / chunk_overlap / top_k 实时可调，左右双栏对比模式同题双参出结果——直观理解切片粒度对检索的影响
- **📚 多知识库**：main / left / right 三库隔离（独立 Chroma collection + 参数 + 对话历史），拖拽上传自动建库
- **🌐 联网资料导入**：粘贴 URL 直接抓取正文入库；或输入关键词聚合 Bing + 搜狗双引擎搜索——先预览各篇标题/来源/摘要，勾选后导入，每篇资料单独成文件（可预览、可删除），自动过滤词典站与反爬站
- **📎 引用溯源**：回答内 `[1][2]` 角标可点击，弹窗展示来源文件、页码、相似度分数与原文片段定位
- **🛡️ 工程化细节**：拒答约束（资料不足明确说不足而非编造）、全中文异常提示（401/402/429/网络）、密钥零硬编码
- **🎨 马卡龙 UI**：奶油波点背景、大脑圆角气泡、Baloo 2 圆体 + 苹果式字重层次、深浅双主题

## 🚀 快速开始

### 0. 环境要求

| 依赖 | 版本 | 说明 |
|---|---|---|
| Python | ≥ 3.10 | 推荐 3.13 |
| Node.js | ≥ 18 | Web 版前端 |
| API Key | ×1~2 | 见[配置说明](#-配置说明) |

### 1. 配置

```bash
git clone https://github.com/baomi888/rag-knowledge-base-demo.git
cd rag-knowledge-base-demo

# 配置密钥（.env 已被 gitignore，严禁提交）
copy .env.example .env    # macOS/Linux: cp .env.example .env
# 编辑 .env 填入真实 Key
```

### 2. 运行方式（三选一）

**方式一 · Web 应用（推荐）** —— 一键启动前后端两个窗口：

```bat
start_all.bat
:: 前端 http://localhost:3000 · 后端 http://localhost:8000/docs
```

**方式二 · Docker Compose**：

```bash
docker-compose up --build
:: 前端 http://localhost:3100 · 后端 http://localhost:8000
```

**方式三 · 控制台 / 预处理脚本（轻量，无需 Node）**：

```bash
pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple

python preprocess.py                 # Demo4：观察切片与向量输出
python rag_console.py --rebuild      # Demo5：控制台 RAG 问答（quit 退出，topk N 调检索数）
```

## ⚙️ 配置说明

| 环境变量 | 说明 | 示例 |
|---|---|---|
| `DEEPSEEK_API_KEY` | LLM 服务密钥 | `sk-...` |
| `DEEPSEEK_BASE_URL` | LLM 接口地址 | `https://api.deepseek.com` |
| `DEEPSEEK_MODEL` | 对话模型 | `deepseek-chat` |
| `EMBEDDING_API_KEY` | 向量化服务密钥 | `sk-...` |
| `EMBEDDING_BASE_URL` | OpenAI 兼容 Embedding 地址 | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| `EMBEDDING_MODEL` | 向量模型 | `text-embedding-v3`（1024 维） |

> **为什么需要两个 Key？** DeepSeek 官方 API 不提供 Embedding 接口，因此 LLM 与向量化分别接入不同服务。若希望单 Key，可将两者都指向硅基流动等聚合平台（注意：余额 ≤ 0 时免费模型同样返回 402）。

## 🔌 API 一览

基础地址 `http://localhost:8000`，完整交互文档见 `/docs`（Swagger UI）。

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/index/status` | 三库状态（片段数/参数/文件列表） |
| `POST` | `/api/index/build` | 建库（multipart，支持文件上传，按 kb 指定目标库） |
| `POST` | `/api/index/url` | 抓取单个网页正文导入知识库 |
| `POST` | `/api/index/search/preview` | 关键词聚合 Bing + 搜狗搜索，返回各篇标题/来源/摘要（不入库，先看后导） |
| `POST` | `/api/index/search/import` | 导入用户勾选的资料（每篇单独成 txt，含来源 URL） |
| `DELETE` | `/api/index/file` | 移除文件并自动重建索引 |
| `GET` | `/api/index/file/content` | 预览知识库文件原文（超长自动截断） |
| `POST` | `/api/chat/stream` | SSE 流式问答（`status` → `token`* → `done`） |
| `POST` | `/api/compare` | 双参数对比问答，左右独立返回 |
| `GET` | `/api/config/defaults` | 默认参数与上传限制 |

## 📁 项目结构

```
rag-knowledge-base-demo/
├── preprocess.py          # Week4 · 预处理：加载 → 切片 → 向量化 → 预览
├── rag_console.py         # Week5 · 控制台 RAG 问答（--rebuild / topk N）
├── rag_core.py            # ★ RAG 共享核心（Load/Split/Embed/Retrieve/Prompt）
├── config.py              # ★ 配置层：集中读取 .env，启动前校验
├── requirements.txt       # 根依赖（控制台 / 脚本）
├── start_all.bat          # Windows 一键启动前后端
├── docker-compose.yml     # Docker 编排
├── backend/               # Week6 · FastAPI
│   ├── main.py            # 应用入口（CORS / 路由 / 生命周期）
│   ├── api/               # index · chat(SSE) · compare 路由
│   ├── core/pipelines.py  # 三库 RagPipeline 单例管理
│   └── schemas.py         # Pydantic 模型
├── frontend/              # Week6 · Next.js 14
│   ├── app/               # App Router（主题 / 全局样式 / 马卡龙变量）
│   ├── components/        # ChatArea · ParamPanel · Sidebar · ComparePanel ...
│   └── lib/               # API 封装 · SSE 解析 · 类型
└── data/                  # 示例知识库（RAG/NBA/天文科普/影视娱乐）+ uploads/
```

## 🧪 实验建议（课堂演示）

1. **切片粒度对比**：左栏 `500/50`，右栏 `200/20` 重建后同题提问——观察片段数量、来源差异与回答质量
2. **top-k 敏感性**：`top_k=1` vs `top_k=8`，体验上下文长度与噪声的权衡
3. **拒答验证**：询问知识库外的问题（如「今天天气如何」），验证提示词约束生效
4. **多库隔离**：切换 main / left / right，同一问题命中不同知识库

## 🧱 踩坑记录

| 问题 | 原因与解法 |
|---|---|
| `RecursiveCharacterTextSplitter` 找不到 | LangChain 0.2+ 分包重构，需 `from langchain_text_splitters import ...`（旧路径 `langchain.text_splitter` 已失效） |
| 更换向量模型后检索错乱 | 不同模型的向量空间不通用，必须重建索引（`--rebuild` / 网页端「重新构建索引」） |
| `langchain-core 1.x` 冲突 | 最新 `langchain-chroma` 会拉取 core 1.x 与 `langchain 0.3` 冲突，锁定 `langchain-chroma<0.3` + `chromadb<0.6` |
| `StopIteration interacts badly with generators` | 线程池中 `next(gen)` 的 StopIteration 不能抛进 asyncio Future，改用哨兵值 `next(gen, _SENTINEL)` |
| Gradio 5.50 兼容 | `gr.Divider` 被移除、`js` 参数迁移至 `launch()`、自定义 theme 字体崩溃——Web 版最终改用 Next.js 方案 |
| 百度反爬触发安全验证 | 无 Cookie 程序化访问经常被弹验证页，搜索改为 Bing + 搜狗双引擎聚合；搜狗 `/link` 跳转无 302，需从页面 `window.location.replace("...")` 提取真实地址 |

## 🔒 安全说明

- 真实密钥只存放于 `.env`（已加入 `.gitignore`，`git check-ignore` 已验证），**严禁提交到仓库**
- `.env.example` 仅含占位符，作为配置模板提交
- 若密钥意外泄露，请立即在对应平台控制台吊销并重新生成

## 🗺️ 路线图

- [x] **Week 4** · RAG 预处理链路（加载 / 切片 / 向量化）
- [x] **Week 5** · 控制台 RAG 问答（Chroma / 检索 / 提示词 / DeepSeek）
- [x] **Week 6** · Web 版（FastAPI + Next.js · SSE 流式 · 对比模式 · 多知识库）
- [x] **Week 7** · 联网资料导入（URL 抓取 · Bing/搜狗双引擎搜索预览 · 勾选导入）
- [ ] 混合检索（BM25 + 向量）与重排序
- [ ] 知识库文件级增量更新
- [ ] 对话记忆与多轮追问

## 📄 License

[MIT](LICENSE) · 课程实践项目，欢迎学习交流
