# rag-knowledge-base-demo

RAG 知识库项目（课程 Demo 系列）

## 当前进度

- [x] **第4周 · Demo4：RAG 预处理链路**（已完成并实测）
  - 本地 txt / PDF 文档加载
  - `RecursiveCharacterTextSplitter` 文本切片
  - 调用 OpenAI 兼容 Embedding 接口生成向量
  - 控制台打印 chunk 预览与向量部分维度
- [x] **第5周 · Demo5：控制台 RAG 问答**（已完成并实测）
  - Chroma 本地持久化向量库（自动建库/复用，支持 `--rebuild` 强制重建）
  - top-k 相似度检索（运行时可通过 `topk N` 动态调整）
  - RAG 提示词组装（系统约束 + 参考资料编号 + 用户问题）
  - 接入 DeepSeek / 硅基流动大模型生成回答
  - 控制台循环交互问答，输入 `quit` / `exit` 退出
  - 检索片段来源展示（文件名 + 页码 + 文本预览）
  - 完善的异常处理（401/402/429/网络错误等全中文提示）
- [x] **第6周 · Demo6：Gradio 网页版 RAG 问答**（已完成并实测）
  - 浏览器交互问答：回答 + 检索到的参考片段（来源/页码标注）并排展示
  - 参数实时调整：chunk_size（100~1000）、chunk_overlap（0~200）、top-k（1~10）滑块
  - 「重新构建索引」按钮：修改切片参数后一键重建向量库
  - 左右两栏对比：同一问题、两组不同参数，回答差异一目了然（每栏顶部显示本次参数快照）
  - 模块化设计：`config.py`（配置）/ `rag_core.py`（RAG 逻辑）/ `app.py`（界面）三层分离
- [x] **方案C · FastAPI + Next.js 前后端分离架构**（已完成）
  - 后端：FastAPI + uvicorn，5 个 REST/SSE 接口，三个 RAG 链路单例管理
  - 前端：Next.js 14 + TypeScript + Tailwind CSS + shadcn/ui，三栏布局
  - SSE 流式逐字渲染，支持客户端中断
  - 对比模式：左右双栏同步问答，参数独立
  - 拖拽上传自动建库，Cmd+K 命令面板，深浅主题切换
  - 原 `app.py`（Gradio）保留不动，作为历史版本

## 技术栈

| 组件 | 说明 |
|---|---|
| Python | 3.13 |
| LangChain | 0.3.x（新分包结构） |
| Embedding | 阿里百炼 DashScope · `text-embedding-v3`（1024 维，每模型免费 100 万 token） |
| 向量数据库 | Chroma（本地持久化，HNSW 索引） |
| 大模型 | DeepSeek 官方 · `deepseek-chat` |
| 网页界面（旧） | Gradio Blocks（`gradio>=4.44`）— `app.py` |
| 后端（新） | FastAPI + uvicorn — `backend/` |
| 前端（新） | Next.js 14 + TypeScript + Tailwind CSS + shadcn/ui — `frontend/` |
| 密钥管理 | python-dotenv + `.env` |

## 目录结构

```
rag-knowledge-base-demo/
├── preprocess.py       # Demo4 主程序：加载 → 切片 → 向量化 → 打印预览
├── rag_console.py      # Demo5 主程序：完整 RAG 控制台问答
├── config.py           # 配置层：集中读取 .env（密钥/路径/默认参数）
├── rag_core.py         # 逻辑层：RAG 全链路（与界面分离，可复用）
├── app.py              # Demo6 界面层：Gradio Blocks 网页（历史版本，保留不动）
├── requirements.txt    # 根依赖清单（Gradio 版本）
├── .env.example        # 环境变量模板（复制为 .env 后填入真实密钥）
├── .gitignore          # 已忽略 .env / chroma_db / __pycache__ 等
├── docker-compose.yml  # 前后端一键启动（方案C）
├── chroma_db/          # Chroma 本地向量库（运行后自动生成，已忽略）
├── data/
│   ├── sample.txt      # txt 测试文档（RAG 介绍文本）
│   ├── test.pdf        # 3 页中文 PDF 测试文档
│   ├── nba.txt         # 体育主题
│   ├── science.txt     # 天文物理科普主题
│   ├── entertainment.txt # 影视音乐娱乐主题
│   └── uploads/        # 前端上传的文件（方案C）
├── backend/            # 方案C · FastAPI 后端
│   ├── main.py         # FastAPI 应用入口
│   ├── api/            # 路由模块（index / chat / compare）
│   ├── core/           # 单例管理（pipelines.py）
│   ├── schemas.py      # Pydantic 模型
│   ├── requirements.txt
│   └── Dockerfile
└── frontend/           # 方案C · Next.js 14 前端
    ├── app/            # App Router（layout / page / globals.css）
    ├── components/     # UI 组件（Navbar / Sidebar / ChatArea / ParamPanel 等）
    ├── lib/            # API 封装 / SSE 解析 / 类型定义
    ├── package.json
    ├── tsconfig.json
    ├── tailwind.config.ts
    └── Dockerfile
```

## 快速开始

### 环境准备

```bash
# 1. 创建并激活虚拟环境（Windows）
python -m venv .venv
.venv\Scripts\activate

# 2. 安装依赖（国内可加清华镜像）
pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple

# 3. 配置密钥：复制 .env.example 为 .env，填入真实 Key
copy .env.example .env
```

### Demo4 · 预处理链路

```bash
# 默认处理 data/sample.txt
python preprocess.py

# 指定其他文档，支持 txt / pdf
python preprocess.py data/test.pdf
```

**输出三步结果：**
1. **文档加载**：文档对象数与总字符数（PDF 每页为 1 个 Document，txt 整文件 1 个）
2. **文本切片**：`chunk_size=500`、`chunk_overlap=50`，中文按段落/句子边界切分
3. **向量化**：每个 chunk 打印文本预览（前 60 字）、向量维度（bge-m3 为 1024 维）与前 5 维数值

### Demo5 · 控制台 RAG 问答

```bash
# 首次运行自动构建向量库，之后直接问答
python rag_console.py

# 强制清空并重建向量库
python rag_console.py --rebuild

# 指定自定义文档（支持多个文件）
python rag_console.py data/sample.txt data/test.pdf
```

**交互命令：**
- 直接输入问题进行问答
- 输入 `quit` 或 `exit` 退出程序
- 输入 `topk 4` 动态调整检索条数（top-k）

**问答流程：**
1. 输入问题后，系统先从向量库中检索 top-k 个最相关的片段
2. 控制台显示命中的片段来源（文件名 + 页码 + 文本预览）
3. 将参考资料与问题组装成 RAG 提示词，调用大模型生成回答
4. 回答末尾标注依据的片段编号（如「依据：[1][3]」）
5. 资料不足时会明确说明「资料不足，无法从知识库中找到相关内容」

### Demo6 · Gradio 网页版 RAG 问答

```bash
python app.py
# 浏览器打开 http://127.0.0.1:7860
```

**功能说明：**

| 控件 | 作用 | 生效时机 |
|---|---|---|
| 问题输入框 + 「🚀 提问」 | 左右两栏同时检索回答，并排对比 | — |
| 切片大小 chunk_size 滑块 | 文本切片最大长度（100~1000，默认 500） | 点「🔄 重新构建索引」后生效 |
| 切片重叠 chunk_overlap 滑块 | 相邻片段重叠长度（0~200，默认 50） | 点「🔄 重新构建索引」后生效 |
| 检索条数 top-k 滑块 | 每次问答检索的片段数（1~10，默认 3） | 下一次提问实时生效 |
| 🔄 重新构建索引 | 按当前切片参数重建该栏向量库 | 立即 |

**功能截图位置**：`docs/screenshot.png`（运行后截图保存至此，README 引用待补）

**对比用法建议**：左栏保持默认参数（500/50/3），右栏调小 chunk_size（如 200）后点重建，输入同一问题，观察片段粒度对回答的影响。

### 方案C · FastAPI + Next.js 前后端分离

#### 一键启动（Docker）

```bash
docker-compose up --build
# 前端：http://localhost:3100
# 后端：http://localhost:8000
```

#### 本地开发启动

```bash
# 终端 1：启动后端
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# 终端 2：启动前端
cd frontend
npm install
npm run dev
# 浏览器打开 http://localhost:3000
# 注意：若 3000 被 VMware(vmnat.exe) 等占用，可用 `npm run dev -- -p 3100` 换端口
```

#### 前端功能

| 功能 | 说明 |
|---|---|
| 三栏布局 | 左侧知识库/文件/上传，中央对话区，右侧参数抽屉 |
| SSE 流式问答 | 逐字渲染回答，支持发送中点击停止中断 |
| 引用可点击 | 回答中 [1][2] 编号点击弹出片段详情（文件名/页码/相似度/文本） |
| 参数调整 | chunk_size / chunk_overlap / top_k 滑块，修改后黄色提示 + 立即重建 |
| 预设方案 | 均衡(500/50/3) / 精细(300/30/5) / 粗略(800/100/2) |
| 对比模式 | 中央区左右双栏，各绑一套参数，同一问题同时出结果，同步滚动 |
| 拖拽上传 | 拖拽文件到页面任意位置出现遮罩，松开上传并自动重建 |
| 文件删除 | 侧栏文件列表悬停/点击垃圾桶图标，移除文件并自动重建索引 |
| 消息工具条 | 悬停消息显示：复制 / 重新生成（‹1/2› 版本回溯）/ 转发分享链接；提问可编辑重发回溯 |
| 引用弹窗 | 点击回答中的 [n] 角标：弹跳反馈 + 弹窗显示来源知识库、命中片段、检索参数，可加载原文预览并高亮定位片段 |
| 历史搜索 | Ctrl+F 或导航栏搜索按钮，检索全部历史对话并跳转高亮；对话自动保存本地，刷新不丢 |
| 多对话管理 | 每个知识库独立对话列表：新建（侧栏 + / Cmd+K）/ 切换 / 删除，标题自动取首个提问，切库自动恢复该库对话 |
| Cmd+K 命令面板 | 切换知识库、应用预设、清空对话、切换主题、切换对比模式 |
| 深浅主题 | next-themes + CSS 变量，深色默认，可切换 |
| 多轮对话 | 每条消息附参数快照，可「用此参数重新生成」 |

#### 后端接口文档

**基础 URL**：`http://localhost:8000`

##### 1. 获取知识库状态

```
GET /api/index/status
```

返回三个库（main / left / right）的片段数、切片参数、文件列表：

```json
{
  "main": {"chunks": 12, "chunk_size": 500, "chunk_overlap": 50, "files": ["data/sample.txt"]},
  "left": {"chunks": 0, "chunk_size": null, "chunk_overlap": null, "files": [...]},
  "right": {...}
}
```

##### 2. 构建索引（支持文件上传）

```
POST /api/index/build
Content-Type: multipart/form-data
```

| 字段 | 类型 | 说明 |
|---|---|---|
| files | File[] | 可选，上传的文档（.txt/.md/.pdf），存到 data/uploads/ |
| chunk_size | int | 切片大小 |
| chunk_overlap | int | 切片重叠 |
| kb | str | 知识库标识：main / left / right，默认 main |

返回：`{"chunks": 15, "status": "索引构建完成，共 15 个片段", "kb": "main", "files": [...]}`

##### 3. 流式问答（SSE）

```
POST /api/chat/stream
Content-Type: application/json

{"question": "什么是RAG？", "top_k": 3, "kb": "main"}
```

SSE 事件流：

| 事件类型 | data 字段 | 说明 |
|---|---|---|
| `status` | `{"text": "正在检索知识库..."}` | 检索开始 |
| `token` | `{"text": "累计回答文本", "refs": "参考片段Markdown"}` | 逐字输出，text 为累计答案 |
| `done` | `{"answer": "完整回答", "refs": "参考片段Markdown"}` | 生成完成 |
| `error` | `{"detail": "中文错误信息"}` | 出错 |

支持客户端断开时自动终止生成（`request.is_disconnected()`）。

##### 4. 对比问答

```
POST /api/compare
Content-Type: application/json

{
  "question": "什么是RAG？",
  "top_k": 3,
  "left_params": {"chunk_size": 500, "chunk_overlap": 50},
  "right_params": {"chunk_size": 300, "chunk_overlap": 30}
}
```

返回左右两栏独立结果：

```json
{
  "left": {"status": "ok", "chunk_size": 500, "chunk_overlap": 50, "chunks": 12, "answer": "...", "refs": "..."},
  "right": {"status": "ok", "chunk_size": 300, "chunk_overlap": 30, "chunks": 8, "answer": "...", "refs": "..."}
}
```

某侧出错时该侧返回 `{"status": "error", "detail": "错误信息"}`，另一侧正常返回。

##### 5. 获取默认配置

```
GET /api/config/defaults
```

返回：`{"chunk_size": 500, "chunk_overlap": 50, "top_k": 3, "supported_extensions": [".txt", ".md", ".pdf"], "max_upload_mb": 50}`

#### 后端架构

```
backend/
├── main.py              # FastAPI 入口，CORS，路由挂载，启动事件
├── api/
│   ├── index.py         # GET /api/index/status, POST /api/index/build
│   ├── chat.py          # POST /api/chat/stream (SSE 流式)
│   └── compare.py       # POST /api/compare
├── core/
│   └── pipelines.py     # 三个 RagPipeline 单例 + 文件列表状态
├── schemas.py           # Pydantic 请求/响应模型
└── requirements.txt
```

- 三个独立链路：`kb_main` / `kb_left` / `kb_right`，Chroma collection 隔离
- 复用根目录 `rag_core.py` 和 `config.py`，不修改核心逻辑
- 上传限制 50MB，CORS 允许 `http://localhost:3000`
- 错误统一返回 `{"detail": "中文错误信息"}`

## 注意事项

- **Embedding 服务**：DeepSeek 官方 API 不提供 Embedding 接口，向量化使用阿里百炼 `text-embedding-v3`（免费额度充足）；**更换向量化模型后需重建索引**（网页端点「🔄 重新构建索引」，控制台用 `--rebuild`）
- **两种配置方案**：
  - **方案B（当前使用）**：大模型走 DeepSeek 官方，向量化走阿里百炼，需分别配置两个 Key
  - **方案A**：大模型和 Embedding 都走硅基流动，一个 Key 通用（注意余额 ≤ 0 时免费模型也会报 402）
- **密钥安全**：真实密钥只放在 `.env`（已被 `.gitignore` 忽略，严禁提交）；`.env.example` 只放占位符
- **向量库复用**：Chroma 数据持久化在 `chroma_db/` 目录，首次建库后再次运行直接复用，省时间省 token；需更新文档时加 `--rebuild` 参数重建
- **LangChain 版本**：本项目基于 0.3.x 新分包结构，导入路径为 `langchain_text_splitters` / `langchain_community.document_loaders` / `langchain_openai` / `langchain_chroma`；旧教程的 `from langchain.text_splitter import ...` 写法在 0.2+ 已失效
- **异常处理**：程序内置文件不存在、格式不支持、密钥缺失、401 认证失败、402 余额不足、429 请求受限、网络连接失败等多类友好报错
