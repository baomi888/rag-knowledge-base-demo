# rag-knowledge-base-demo

RAG 知识库项目（课程 Demo 系列）

## 当前进度

- [x] **第4周 · Demo4：RAG 预处理链路**（已完成并实测）
  - 本地 txt / PDF 文档加载
  - `RecursiveCharacterTextSplitter` 文本切片
  - 调用 OpenAI 兼容 Embedding 接口生成向量
  - 控制台打印 chunk 预览与向量部分维度
- [ ] 第5周：Chroma 向量库入库、Prompt 组装、RAG 问答

## 技术栈

| 组件 | 说明 |
|---|---|
| Python | 3.13 |
| LangChain | 0.3.x（新分包结构） |
| Embedding | 硅基流动 SiliconFlow · `BAAI/bge-m3`（1024 维） |
| 密钥管理 | python-dotenv + `.env` |

## 目录结构

```
rag-knowledge-base-demo/
├── preprocess.py       # Demo4 主程序：加载 → 切片 → 向量化 → 打印预览
├── requirements.txt    # 依赖清单
├── .env.example        # 环境变量模板（复制为 .env 后填入真实密钥）
├── .gitignore          # 已忽略 .env / __pycache__ 等
└── data/
    ├── sample.txt      # txt 测试文档
    └── test.pdf        # 3 页中文 PDF 测试文档
```

## 快速开始

```bash
# 1. 创建并激活虚拟环境（Windows）
python -m venv .venv
.venv\Scripts\activate

# 2. 安装依赖（国内可加清华镜像）
pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple

# 3. 配置密钥：复制 .env.example 为 .env，填入真实 Key
copy .env.example .env

# 4. 运行（默认处理 data/sample.txt）
python preprocess.py

# 指定其他文档，支持 txt / pdf
python preprocess.py data/test.pdf
```

## 输出说明

程序依次输出三步结果：

1. **文档加载**：文档对象数与总字符数（PDF 每页为 1 个 Document，txt 整文件 1 个）
2. **文本切片**：`chunk_size=500`、`chunk_overlap=50`，中文按段落/句子边界切分
3. **向量化**：每个 chunk 打印文本预览（前 60 字）、向量维度（bge-m3 为 1024 维）与前 5 维数值，不打印完整长向量

## 注意事项

- **Embedding 服务**：DeepSeek 官方 API 暂不提供 Embedding 接口，`EMBEDDING_BASE_URL` 需指向 OpenAI 兼容服务（如硅基流动 `https://api.siliconflow.cn/v1`），`DEEPSEEK_API_KEY` 填对应平台的 Key
- **密钥安全**：真实密钥只放在 `.env`（已被 `.gitignore` 忽略，严禁提交）；`.env.example` 只放占位符
- **LangChain 版本**：本项目基于 0.3.x 新分包结构，导入路径为 `langchain_text_splitters` / `langchain_community.document_loaders` / `langchain_openai`；旧教程的 `from langchain.text_splitter import ...` 写法在 0.2+ 已失效
- **异常处理**：程序内置文件不存在、格式不支持、密钥缺失、401 认证失败四类友好报错
