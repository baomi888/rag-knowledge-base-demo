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
- [ ] 第6周：Gradio Web UI 界面（规划中）

## 技术栈

| 组件 | 说明 |
|---|---|
| Python | 3.13 |
| LangChain | 0.3.x（新分包结构） |
| Embedding | 阿里百炼 DashScope · `text-embedding-v3`（1024 维，每模型免费 100 万 token） |
| 向量数据库 | Chroma（本地持久化，HNSW 索引） |
| 大模型 | DeepSeek 官方 · `deepseek-chat` |
| 密钥管理 | python-dotenv + `.env` |

## 目录结构

```
rag-knowledge-base-demo/
├── preprocess.py       # Demo4 主程序：加载 → 切片 → 向量化 → 打印预览
├── rag_console.py      # Demo5 主程序：完整 RAG 控制台问答
├── restructure_env.py  # 辅助脚本：.env 方案A ↔ 方案B 切换
├── demo.py             # 初始化占位（早期 Demo）
├── requirements.txt    # 依赖清单
├── .env.example        # 环境变量模板（复制为 .env 后填入真实密钥）
├── .gitignore          # 已忽略 .env / chroma_db / __pycache__ 等
├── chroma_db/          # Chroma 本地向量库（运行后自动生成，已忽略）
└── data/
    ├── sample.txt      # txt 测试文档（RAG 介绍文本）
    └── test.pdf        # 3 页中文 PDF 测试文档
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

## 注意事项

- **Embedding 服务**：DeepSeek 官方 API 暂不提供 Embedding 接口，`EMBEDDING_BASE_URL` 需指向 OpenAI 兼容服务（如硅基流动 `https://api.siliconflow.cn/v1`），`DEEPSEEK_API_KEY` 填对应平台的 Key
- **两种配置方案**：
  - **方案A（推荐）**：大模型和 Embedding 都走硅基流动，一个 Key 通用，`.env.example` 默认即此方案
  - **方案B**：大模型走 DeepSeek 官方，向量走硅基流动，需分别配置两个 Key；可运行 `python restructure_env.py` 一键切换
- **密钥安全**：真实密钥只放在 `.env`（已被 `.gitignore` 忽略，严禁提交）；`.env.example` 只放占位符
- **向量库复用**：Chroma 数据持久化在 `chroma_db/` 目录，首次建库后再次运行直接复用，省时间省 token；需更新文档时加 `--rebuild` 参数重建
- **LangChain 版本**：本项目基于 0.3.x 新分包结构，导入路径为 `langchain_text_splitters` / `langchain_community.document_loaders` / `langchain_openai` / `langchain_chroma`；旧教程的 `from langchain.text_splitter import ...` 写法在 0.2+ 已失效
- **异常处理**：程序内置文件不存在、格式不支持、密钥缺失、401 认证失败、402 余额不足、429 请求受限、网络连接失败等多类友好报错
