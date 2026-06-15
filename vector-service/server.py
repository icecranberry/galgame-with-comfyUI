"""
Python FastAPI 向量服务
提供嵌入推理和向量检索引擎

启动: uvicorn server:app --host 0.0.0.0 --port 8765
"""

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
import uuid
import cloudscraper
from bs4 import BeautifulSoup

from embedding import embed, embed_single
from chroma_store import upsert_memory, search_similar, delete_by_id, collection_count

app = FastAPI(title="Vector Service", version="1.0.0")


# ── Request / Response models ──

class EmbedRequest(BaseModel):
    text: str | list[str] = Field(..., description="文本或文本列表")


class EmbedResponse(BaseModel):
    embeddings: list[list[float]]


class SearchRequest(BaseModel):
    text: str = Field(..., description="查询文本")
    top_k: int = Field(default=20, ge=1, le=100)
    filter_type: str | None = Field(default=None, pattern="^(fact|preference|emotion)$")


class SearchResult(BaseModel):
    id: str
    score: float
    metadata: dict
    document: str


class SearchResponse(BaseModel):
    results: list[SearchResult]


class UpsertRequest(BaseModel):
    chroma_id: str | None = None
    text: str
    metadata: dict = Field(default_factory=dict)
    fragment_type: str | None = None


class UpsertResponse(BaseModel):
    chroma_id: str


class DeleteRequest(BaseModel):
    chroma_id: str


# ── Routes ──

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "collection_count": collection_count(),
    }


@app.post("/embed", response_model=EmbedResponse)
async def embed_route(req: EmbedRequest):
    texts = req.text if isinstance(req.text, list) else [req.text]
    try:
        embeddings = embed(texts)
        return EmbedResponse(embeddings=embeddings)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/search", response_model=SearchResponse)
async def search_route(req: SearchRequest):
    try:
        vec = embed_single(req.text)
        items = search_similar(vec, top_k=req.top_k, filter_type=req.filter_type)
        return SearchResponse(
            results=[SearchResult(**item) for item in items]
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/upsert", response_model=UpsertResponse)
async def upsert_route(req: UpsertRequest):
    try:
        vec = embed_single(req.text)
        chroma_id = req.chroma_id or str(uuid.uuid4())

        metadata = {**req.metadata}
        if req.fragment_type:
            metadata["fragment_type"] = req.fragment_type

        upsert_memory(chroma_id, vec, metadata, req.text)
        return UpsertResponse(chroma_id=chroma_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/delete")
async def delete_route(req: DeleteRequest):
    try:
        delete_by_id(req.chroma_id)
        return {"ok": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── 萌娘百科爬虫 ──

class ScrapeRequest(BaseModel):
    url: str

class ScrapeResponse(BaseModel):
    title: str = ''
    content: str = ''
    source: str = ''

_scraper = cloudscraper.create_scraper()

@app.post("/scrape", response_model=ScrapeResponse)
async def scrape_moegirl(req: ScrapeRequest):
    """爬取萌娘百科页面，返回正文 + 结构化基本资料"""
    fetch_url = req.url.replace('mzh.moegirl.org.cn', 'zh.moegirl.org.cn')
    print(f"[scrape] fetching {fetch_url}")

    try:
        resp = _scraper.get(fetch_url, timeout=12)
        resp.raise_for_status()
        print(f"[scrape] status: {resp.status_code}, bytes: {len(resp.content)}")
    except Exception as e:
        print(f"[scrape] fetch failed: {e}")
        raise HTTPException(502, f"fetch failed: {e}")

    soup = BeautifulSoup(resp.content, 'lxml', from_encoding='utf-8')

    # 正文被包裹在 <template id="MOE_SKIN_TEMPLATE_BODYCONTENT"> 内（Vue 渲染用）
    # 需要提取模板内容单独解析
    article = None
    template = soup.select_one('template#MOE_SKIN_TEMPLATE_BODYCONTENT')
    if template:
        import re
        html_text = resp.content.decode('utf-8', errors='replace')
        tmpl_match = re.search(
            r'<template[^>]*id="MOE_SKIN_TEMPLATE_BODYCONTENT"[^>]*>([\s\S]*?)</template>',
            html_text, re.I
        )
        if tmpl_match:
            inner = tmpl_match.group(1)
            inner_soup = BeautifulSoup(inner, 'lxml')
            article = (
                inner_soup.select_one('#moe-article') or
                inner_soup.select_one('#mw-content-text') or
                inner_soup.select_one('.mw-parser-output')
            )

    if not article:
        # 降级：直接在原始 soup 中查找
        article = (
            soup.select_one('#moe-article') or
            soup.select_one('#mw-content-text') or
            soup.select_one('.mw-parser-output')
        )

    if not article:
        print("[scrape] content not found in template or page")
        raise HTTPException(404, 'content not found')

    # 去掉 navbox / script / style
    for tag in article.select('table.navbox, script, style'):
        tag.decompose()

    # 保留 img alt 文本
    for img in article.select('img[alt]'):
        alt = img.get('alt', '')
        if alt:
            img.replace_with(f' ({alt}) ')

    # 正文纯文本
    text = article.get_text(separator='\n', strip=True)
    text = '\n'.join(text.split('\n')[:400])

    # 过滤游戏数值行
    import re
    game_kw = re.compile(
        r'暴击|伤害|强化特殊技|特殊技|增益|减益|冷却|能量|触发'
        r'|充能|抗打断|提升\d+%|造成的伤害|持续\d+秒|发动'
        r'|buff|debuff|命之座|神之眼|神之心|始基力|特色料理'
        r'|武器\d?|音擎|驱动盘', re.I
    )
    lines = [l for l in text.split('\n') if not game_kw.search(l)]
    text = '\n'.join(lines)[:8000]

    # 提取结构化基本资料
    raw = article.get_text()
    idx = raw.find('基本资料')
    fields_output = ''
    if idx >= 0:
        end = raw.find('简介', idx + 4)
        block = raw[idx:end].strip() if end >= 0 else raw[idx:idx+3000].strip()
        char_fields = {
            '本名','外文名','别号','昵称','称号',
            '性别','发色','瞳色','身高','体重','三围',
            '生日','年龄','种族','血型','星座',
            '萌点','爱好','喜欢','讨厌',
            '出身地区','出身','活动范围','所属团体','所属组织','组合',
            '个人状态','状态','配音','声优','相关人士',
        }
        all_field_names = [
            '本名','外文名','别号','昵称','称号',
            '性别','发色','瞳色','身高','体重','三围',
            '生日','年龄','种族','血型','星座',
            '萌点','爱好','喜欢','讨厌',
            '出身地区','出身','活动范围','所属团体','所属组织','组合',
            '个人状态','状态','配音','声优',
            '武器','神之眼','神之心','命之座','始基力','特色料理','相关人士',
        ]
        fp = []
        for name in all_field_names:
            p = block.find(name)
            if p >= 0 and (p == 0 or block[p-1] == ' '):
                fp.append((p, name))
        fp.sort(key=lambda x: x[0])
        if fp:
            out = ['【萌娘百科 · 基本资料】']
            for i, (pos, name) in enumerate(fp):
                end_pos = fp[i+1][0] if i+1 < len(fp) else len(block)
                val = block[pos+len(name):end_pos].strip()
                if val and name in char_fields:
                    out.append(f'{name}: {val}')
            fields_output = '\n'.join(out)

    title = soup.title.string if soup.title else ''
    title = title.replace(' - 萌娘百科', '').replace('万物皆可萌的百科全书', '').strip()

    print(f"[scrape] done: body={len(text)} chars, fields={len(fields_output)} chars")
    return ScrapeResponse(title=title, content=text + '\n' + fields_output, source=req.url)


# ── Startup ──

@app.on_event("startup")
async def startup():
    print("[vector-service] startup — warming up embedding model...")
    try:
        embed_single("预热")
        print("[vector-service] embedding model warm-up complete")
    except Exception as e:
        print(f"[vector-service] warm-up failed: {e}")
        # 不阻止启动，首次请求时会有延迟


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8765)
