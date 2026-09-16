# -*- coding: utf-8 -*-
"""索引相关接口：
- GET    /status         查看三个库当前状态
- POST   /build          （可选）上传新文件 + 按新切片参数重建指定库
- DELETE /file           从指定库移除一个文件并自动重建索引
- GET    /file/content   预览 data/ 内文件内容（引用弹窗原文预览用）
"""

import os
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.parse import urlparse, urljoin

import httpx
from bs4 import BeautifulSoup
from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel

import config
import rag_core
from core.pipelines import (
    KB_FILES,
    VALID_KEYS,
    add_files,
    get_pipeline,
    get_status,
    remove_file,
    reset_kb,
)

router = APIRouter()

# 上传大小上限 50MB
MAX_UPLOAD_BYTES = 50 * 1024 * 1024


def _safe_filename(name: str) -> str:
    """生成安全文件名：剥离路径成分，只保留安全字符，避免路径穿越。"""
    name = os.path.basename(name or "").strip()
    # 保留中英文、数字、点、下划线、短横线，其余替换为下划线
    name = re.sub(r"[^\w.\-\u4e00-\u9fff]", "_", name)
    return name or "upload"


@router.get("/status")
def index_status():
    """返回三个库的状态（磁盘片段数 + 参数 + 文件列表）。"""
    return {key: get_status(key) for key in VALID_KEYS}


@router.post("/build")
def index_build(
    kb: str = Form(default="main", description="目标知识库 main/left/right"),
    chunk_size: int = Form(default=config.CHUNK_SIZE_DEFAULT, description="切片大小"),
    chunk_overlap: int = Form(default=config.CHUNK_OVERLAP_DEFAULT, description="切片重叠"),
    files: list[UploadFile] | None = File(default=None, description="可选，多个待上传文件"),
):
    """重建指定库索引；可附带上传新文件（保存到 data/uploads/）。"""
    # ---- 参数校验 ----
    if kb not in VALID_KEYS:
        raise HTTPException(status_code=400, detail=f"未知知识库：{kb}（可选 main/left/right）")
    if chunk_size <= 0:
        raise HTTPException(status_code=400, detail="chunk_size 必须为正整数")
    if chunk_overlap < 0:
        raise HTTPException(status_code=400, detail="chunk_overlap 不能为负数")

    pipeline = get_pipeline(kb)

    # ---- 准备上传目录 ----
    upload_dir = os.path.join(config.DATA_DIR, "uploads")
    os.makedirs(upload_dir, exist_ok=True)

    # ---- 保存上传文件（允许不传文件，仅改参数重建）----
    new_paths: list[str] = []
    for uf in (files or []):
        if uf is None:
            continue
        content = uf.file.read()
        if not content:
            continue
        # 50MB 限制
        if len(content) > MAX_UPLOAD_BYTES:
            raise HTTPException(
                status_code=413,
                detail=f"文件 {uf.filename} 超过 50MB 上传限制",
            )
        # 扩展名白名单
        ext = os.path.splitext(uf.filename or "")[1].lower()
        if ext not in rag_core.SUPPORTED_EXT:
            raise HTTPException(
                status_code=400,
                detail=f"不支持的文件格式：{ext}（仅支持 {', '.join(rag_core.SUPPORTED_EXT)}）",
            )
        # 写入磁盘
        fname = _safe_filename(uf.filename)
        fpath = os.path.join(upload_dir, fname)
        with open(fpath, "wb") as f:
            f.write(content)
        new_paths.append(fpath)

    # 把新文件追加到该库的文件列表
    if new_paths:
        add_files(kb, new_paths)

    # ---- 重建索引（使用该库当前完整文件列表）----
    try:
        chunks = pipeline.build_index(
            chunk_size, chunk_overlap, paths=list(KB_FILES[kb])
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=rag_core.describe_api_error(e)
        )

    return {
        "chunks": chunks,
        "status": f"索引构建完成，共 {chunks} 个片段",
        "kb": kb,
        "files": list(KB_FILES[kb]),
    }


class UrlIngestRequest(BaseModel):
    """网页导入请求体：URL + 目标知识库。"""

    url: str
    kb: str = "main"


# 伪装浏览器 UA，避免部分网站直接拒绝程序化访问
_FETCH_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
}


def _extract_html_text(html: str) -> tuple[str, str]:
    """HTML → (标题, 正文文本)。

    剔除 script/style/导航/页脚等噪声标签后，优先取 <article>/<main>，
    否则取 <body>；逐行去空并压缩连续空行。
    """
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "nav", "footer", "header", "aside", "noscript", "form", "iframe"]):
        tag.decompose()
    title = soup.title.get_text(strip=True) if soup.title else ""
    root = soup.find("article") or soup.find("main") or soup.body or soup
    lines = [ln.strip() for ln in root.get_text("\n").splitlines()]
    clean = re.sub(r"\n{3,}", "\n\n", "\n".join(ln for ln in lines if ln)).strip()
    return title, clean


def _is_junk_host(url: str) -> bool:
    """过滤词典/翻译类站点：这类页面对知识库没有资料价值。"""
    host = urlparse(url).netloc.lower()
    if host.startswith(("dict.", "fanyi.", "global.bing.com")):
        return True
    return any(k in host for k in ("iciba.com", "youdao.com", "dict.cn"))


def _fetch_article(url: str) -> tuple[str, str, str] | None:
    """抓取单篇正文。成功返回 (标题, 正文, 最终URL)，失败/过短/非 HTML 返回 None。"""
    try:
        r = httpx.get(url, headers=_FETCH_HEADERS, timeout=20.0, follow_redirects=True)
        r.raise_for_status()
        if "html" not in r.headers.get("content-type", "html"):
            return None
        t_title, t_text = _extract_html_text(r.text)
        if len(t_text) < 150:
            return None
        return t_title, t_text, str(r.url)
    except Exception:
        return None


def _bing_candidates(query: str) -> list[dict]:
    """Bing 第一页自然结果（服务端翻页不可用，固定约 10 条）。"""
    resp = httpx.get(
        "https://cn.bing.com/search",
        params={"q": query, "count": "15"},
        headers=_FETCH_HEADERS,
        timeout=15.0,
        follow_redirects=True,
    )
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")
    out = []
    for li in soup.select("li.b_algo"):
        a = li.find("a", href=True)
        if a and a["href"].startswith("http"):
            out.append({"title": a.get_text(strip=True), "url": a["href"]})
    return out


def _baidu_candidates(query: str) -> list[dict]:
    """百度搜索结果（无 Cookie 访问常触发安全验证，仅作兜底）。"""
    resp = httpx.get(
        "https://www.baidu.com/s",
        params={"wd": query, "rn": "15"},
        headers=_FETCH_HEADERS,
        timeout=15.0,
        follow_redirects=True,
    )
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")
    out = []
    for a in soup.select("div.result h3 a[href], div.result-op h3 a[href]"):
        if a["href"].startswith("http") and a.get_text(strip=True):
            out.append({"title": a.get_text(strip=True), "url": a["href"]})
    return out


# 搜狗跳转页中的真实地址藏在 window.location.replace("...") 里
_SOGOU_REDIRECT_RE = re.compile(r'window\.location\.replace\("([^"]+)"\)')


def _sogou_candidates(query: str) -> list[dict]:
    """搜狗搜索结果：/link 跳转链接解析为真实地址（常含微信公众号文章）。"""
    sogou_headers = {**_FETCH_HEADERS, "Referer": "https://www.sogou.com/web"}
    resp = httpx.get(
        "https://www.sogou.com/web",
        params={"query": query},
        headers=sogou_headers,
        timeout=15.0,
        follow_redirects=True,
    )
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")
    items: list[dict] = []
    for a in soup.select(".vrwrap h3 a, .rb h3 a"):
        href = a.get("href", "")
        title = a.get_text(strip=True)
        if not href or not title:
            continue
        if href.startswith("/link"):
            items.append({"title": title, "url": urljoin("https://www.sogou.com", href)})
        elif href.startswith("http"):
            items.append({"title": title, "url": href})

    def resolve(u: str) -> str:
        if "sogou.com/link" not in u:
            return u
        try:
            r = httpx.get(u, headers=sogou_headers, timeout=10.0, follow_redirects=False)
            if r.status_code in (301, 302) and r.headers.get("location"):
                return r.headers["location"]
            m = _SOGOU_REDIRECT_RE.search(r.text[:2000])
            if m:
                return m.group(1)
        except Exception:
            pass
        return u  # 解析失败返回原链接，由后续正文抓取兜底过滤

    out: list[dict] = []
    with ThreadPoolExecutor(max_workers=4) as pool:
        for it, real in zip(items, pool.map(resolve, [it["url"] for it in items])):
            out.append({"title": it["title"], "url": real})
    return out


def _search_candidates(query: str, cap: int = 20) -> list[dict]:
    """聚合 Bing + 搜狗两路搜索候选：去重、过滤词典站，Bing 相关度优先。"""
    seen: set[str] = set()
    candidates: list[dict] = []
    for getter in (_bing_candidates, _sogou_candidates):
        try:
            items = getter(query)
        except Exception:
            continue  # 单引擎故障不影响另一路
        for item in items:
            if item["url"] in seen or _is_junk_host(item["url"]):
                continue
            seen.add(item["url"])
            candidates.append(item)
    return candidates[:cap]


@router.post("/url")
def index_ingest_url(req: UrlIngestRequest):
    """网页导入（ima 式）：抓取 URL 正文 → 存为 txt → 入库并重建索引。

    - 仅支持 http/https 与 HTML/文本页面；
    - 正文少于 100 字符视为提取失败（多为 JS 动态渲染页）；
    - 文件保存到 data/uploads/web_<域名>_<时间戳>.txt，头部记录来源信息。
    """
    if req.kb not in VALID_KEYS:
        raise HTTPException(status_code=400, detail=f"未知知识库：{req.kb}（可选 main/left/right）")

    url = req.url.strip()
    if not re.match(r"^https?://", url):
        raise HTTPException(status_code=400, detail="URL 需以 http:// 或 https:// 开头")

    # ---- 抓取 ----
    try:
        resp = httpx.get(url, headers=_FETCH_HEADERS, timeout=15.0, follow_redirects=True)
        resp.raise_for_status()
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="抓取超时（15 秒）：网站响应太慢或不可达")
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=502, detail=f"网站返回错误：HTTP {e.response.status_code}")
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"无法访问该网页：{type(e).__name__}，请检查链接")

    ctype = resp.headers.get("content-type", "")
    if ctype and "html" not in ctype and "text" not in ctype:
        raise HTTPException(
            status_code=400,
            detail=f"不支持的网页类型：{ctype.split(';')[0]}（仅支持 HTML/文本页面）",
        )

    # ---- 提取正文 ----
    title, text = _extract_html_text(resp.text)
    if len(text) < 100:
        raise HTTPException(
            status_code=422,
            detail="正文提取失败或内容过短（页面可能是 JS 动态渲染），建议换成文章详情页链接",
        )

    # ---- 落盘 ----
    host = re.sub(r"[^\w.\-]", "_", urlparse(url).netloc)
    fname = _safe_filename(f"web_{host}_{int(time.time())}.txt")
    fpath = os.path.join(config.DATA_DIR, "uploads", fname)
    os.makedirs(os.path.dirname(fpath), exist_ok=True)
    with open(fpath, "w", encoding="utf-8") as f:
        f.write(f"来源: {url}\n标题: {title}\n抓取时间: {time.strftime('%Y-%m-%d %H:%M:%S')}\n\n{text}")

    # ---- 入库并重建（沿用该库当前切片参数）----
    add_files(req.kb, [fpath])
    pipeline = get_pipeline(req.kb)
    params = pipeline._params or (config.CHUNK_SIZE_DEFAULT, config.CHUNK_OVERLAP_DEFAULT)
    try:
        chunks = pipeline.build_index(params[0], params[1], paths=list(KB_FILES[req.kb]))
    except Exception as e:
        raise HTTPException(status_code=500, detail=rag_core.describe_api_error(e))

    return {
        "chunks": chunks,
        "title": title or fname,
        "chars": len(text),
        "file": fpath,
        "kb": req.kb,
        "status": f"网页已导入并重建索引，共 {chunks} 个片段",
    }


class SearchPreviewRequest(BaseModel):
    """关键词搜索预览请求：只搜摘要不入库。"""

    query: str
    max_results: int = 8


@router.post("/search/preview")
def index_search_preview(req: SearchPreviewRequest):
    """关键词搜索预览（ima 式先看后导）：聚合 Bing + 百度候选并并发取正文摘要，不写入知识库。

    - 过滤词典/翻译站，抓取失败的条目（反爬/JS 渲染）自动跳过；
    - 按最终真实地址去重后全部返回，由用户在弹窗中勾选。
    """
    query = req.query.strip()
    if not query:
        raise HTTPException(status_code=400, detail="请输入搜索关键词")
    max_n = max(1, min(req.max_results, 15))

    try:
        candidates = _search_candidates(query)
    except httpx.HTTPError:
        raise HTTPException(status_code=502, detail="无法访问搜索引擎，请检查网络")
    if not candidates:
        raise HTTPException(status_code=422, detail="搜索引擎暂时不可用或未搜到结果，请稍后再试")

    # 并发抓取候选页正文（约 20 条候选，8 线程），保留搜索相关度顺序
    fetched: list[tuple[int, tuple[str, str, str]]] = []
    with ThreadPoolExecutor(max_workers=8) as pool:
        futs = [(i, pool.submit(_fetch_article, it["url"])) for i, it in enumerate(candidates)]
        for i, fut in futs:
            got = fut.result()
            if got is not None:
                fetched.append((i, got))
    if not fetched:
        raise HTTPException(status_code=422, detail="结果正文抓取均失败（可能反爬/JS 渲染），换个关键词试试")

    # 按最终真实地址去重（Bing 直链与百度跳转可能指向同一篇文章）
    seen_final: set[tuple[str, str]] = set()
    results = []
    for _, (t_title, t_text, final_url) in sorted(fetched):
        u = urlparse(final_url)
        key = (u.netloc.lower(), u.path)
        if key in seen_final:
            continue
        seen_final.add(key)
        results.append({
            "title": t_title,
            "url": final_url,
            "chars": len(t_text),
            "preview": t_text[:200],
        })
    return {"query": query, "results": results[:max_n]}


class SearchImportRequest(BaseModel):
    """按用户勾选的 URL 抓正文，每篇文章单独存档入库。"""

    query: str
    kb: str = "main"
    urls: list[str]


@router.post("/search/import")
def index_search_import(req: SearchImportRequest):
    """导入用户在预览弹窗中勾选的资料。

    - 每篇文章单独保存为一个 txt（搜索01_标题.txt…），与手动上传的文件一样
      出现在侧栏文件列表中，可逐篇预览/删除；
    - 文件头部记录来源 URL，全部保存后一次性重建索引。
    """
    if req.kb not in VALID_KEYS:
        raise HTTPException(status_code=400, detail=f"未知知识库：{req.kb}")
    urls = [u.strip() for u in req.urls if u.strip().startswith("http")][:10]
    if not urls:
        raise HTTPException(status_code=400, detail="未选择任何资料")

    upload_dir = os.path.join(config.DATA_DIR, "uploads")
    os.makedirs(upload_dir, exist_ok=True)
    stamp = int(time.time())
    saved: list[str] = []

    # 并发抓取用户勾选的文章，按勾选顺序编号落盘
    with ThreadPoolExecutor(max_workers=8) as pool:
        futs = [(u, pool.submit(_fetch_article, u)) for u in urls]
        for i, (u, fut) in enumerate(futs, start=1):
            got = fut.result()
            if got is None:
                continue
            t_title, t_text, final_url = got
            fname = _safe_filename(f"搜索{i:02d}_{(t_title or req.query)[:36]}_{stamp}.txt")
            fpath = os.path.join(upload_dir, fname)
            with open(fpath, "w", encoding="utf-8") as f:
                f.write(
                    f"来源: {final_url}\n标题: {t_title}\n"
                    f"导入时间: {time.strftime('%Y-%m-%d %H:%M:%S')}\n\n{t_text[:8000]}"
                )
            saved.append(fpath)
    if not saved:
        raise HTTPException(status_code=422, detail="所选资料正文抓取均失败，请重选其他结果")

    add_files(req.kb, saved)
    pipeline = get_pipeline(req.kb)
    params = pipeline._params or (config.CHUNK_SIZE_DEFAULT, config.CHUNK_OVERLAP_DEFAULT)
    try:
        chunks = pipeline.build_index(params[0], params[1], paths=list(KB_FILES[req.kb]))
    except Exception as e:
        raise HTTPException(status_code=500, detail=rag_core.describe_api_error(e))

    return {
        "chunks": chunks,
        "articles": len(saved),
        "query": req.query,
        "files": saved,
        "kb": req.kb,
        "status": f"已导入选中的 {len(saved)} 篇资料（每篇单独成文件），共 {chunks} 个片段",
    }


@router.delete("/file")
def index_delete_file(
    kb: str = Query(description="目标知识库 main/left/right"),
    file: str = Query(description="要移除的文件完整路径（须在该库文件列表中）"),
):
    """从指定库移除一个文件并自动重建索引。

    - 仅移除 data/uploads/ 目录内的文件时会同时删除磁盘文件；
      默认知识库文件（data/ 下）只移出列表，不删磁盘。
    - 移除后若该库无剩余文件，则直接清空该库（chunks=0）。
    """
    if kb not in VALID_KEYS:
        raise HTTPException(status_code=400, detail=f"未知知识库：{kb}（可选 main/left/right）")

    if not remove_file(kb, file):
        raise HTTPException(status_code=404, detail=f"文件不在该知识库中：{file}")

    # 磁盘删除：仅限 uploads 目录内的文件（路径先 abspath 归一化再前缀匹配，防穿越）
    upload_dir = os.path.abspath(os.path.join(config.DATA_DIR, "uploads"))
    abs_file = os.path.abspath(file)
    if (
        abs_file.startswith(upload_dir + os.sep)
        and os.path.isfile(abs_file)
        and os.path.commonpath([abs_file, upload_dir]) == upload_dir
    ):
        try:
            os.remove(abs_file)
        except OSError:
            pass  # 磁盘删除失败不阻塞流程，列表已移除

    remaining = list(KB_FILES[kb])
    pipeline = get_pipeline(kb)

    if not remaining:
        reset_kb(kb)
        return {
            "chunks": 0,
            "status": "已移除全部文件，该知识库已清空",
            "kb": kb,
            "files": [],
        }

    # 沿用该库当前切片参数重建（未建过库则用默认值）
    params = pipeline._params or (config.CHUNK_SIZE_DEFAULT, config.CHUNK_OVERLAP_DEFAULT)
    try:
        chunks = pipeline.build_index(params[0], params[1], paths=remaining)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=rag_core.describe_api_error(e))

    return {
        "chunks": chunks,
        "status": f"已移除文件并重建索引，剩余 {chunks} 个片段",
        "kb": kb,
        "files": remaining,
    }


@router.get("/file/content")
def index_file_content(
    file: str = Query(description="文件路径（须位于 data/ 目录内）"),
    max_chars: int = Query(default=200_000, ge=1_000, le=1_000_000, description="返回的最大字符数"),
):
    """预览 data/ 目录内文件的文本内容（引用弹窗的「原文预览」用）。

    - 仅允许访问 DATA_DIR 之内的文件（abspath + commonpath 双重校验防穿越）；
    - .txt/.md 直接读文本（utf-8 失败回退 gbk）；.pdf 用 PyPDFLoader 提取；
    - 超过 max_chars 时截断并标记 truncated。
    """
    root = os.path.abspath(config.DATA_DIR)
    abs_file = os.path.abspath(file)
    try:
        inside = os.path.commonpath([abs_file, root]) == root
    except ValueError:  # 跨盘符等无法比较的情况
        inside = False
    if not inside:
        raise HTTPException(status_code=403, detail="仅允许预览 data/ 目录内的文件")
    if not os.path.isfile(abs_file):
        raise HTTPException(status_code=404, detail=f"文件不存在：{file}")

    ext = os.path.splitext(abs_file)[1].lower()
    if ext not in rag_core.SUPPORTED_EXT:
        raise HTTPException(status_code=400, detail=f"不支持的格式：{ext}")

    if ext == ".pdf":
        try:
            docs = rag_core.load_document(abs_file)
            full_text = "\n\n".join(d.page_content for d in docs)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"PDF 解析失败：{e}")
    else:
        full_text = None
        for enc in ("utf-8", "gbk"):
            try:
                with open(abs_file, encoding=enc) as f:
                    full_text = f.read()
                break
            except UnicodeDecodeError:
                continue
        if full_text is None:
            raise HTTPException(status_code=400, detail="无法解码文本文件（非 UTF-8/GBK）")

    total = len(full_text)
    return {
        "file": file,
        "name": os.path.basename(abs_file),
        "ext": ext,
        "content": full_text[:max_chars],
        "total_chars": total,
        "truncated": total > max_chars,
    }
