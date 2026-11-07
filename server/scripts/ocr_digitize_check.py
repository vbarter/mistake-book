"""拿一张卷子照片，按线上同样的流程跑「百度 OCR → 大模型逐页还原」第一步，打印 OCR 文字和还原出的题目，用来对比 OCR 改动的效果。
在 server/ 目录下运行：python scripts/ocr_digitize_check.py <图片> [--env .env] [--out 结果.json] [--grade 五年级] [--no-ocr]
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("image")
    ap.add_argument("--env", default=".env")
    ap.add_argument("--out", default="")
    ap.add_argument("--grade", default="五年级")
    ap.add_argument("--subjects", default="chinese,math,english")
    ap.add_argument("--no-ocr", action="store_true")
    args = ap.parse_args()

    from dotenv import load_dotenv

    load_dotenv(args.env)
    from app.ai import claude, ocr

    data = open(args.image, "rb").read()
    t = time.time()
    page = None if args.no_ocr else ocr.ocr_page(data)
    t_ocr = time.time() - t
    content: list[dict] = [{"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": base64.standard_b64encode(data).decode()}}]
    if page and page.text:
        content.append({"type": "text", "text": "OCR 模型逐行识别出的文字（已按分栏排序，栏间空行；公式为 LaTeX；印刷内容以此为准逐字照抄；以 [手写] 开头的行是 OCR 猜测的学生手写，可能有误，以照片为准；以 [图中文字] 开头的行在插图或表格里，只能写进 figure 块）：\n<ocr>\n" + page.text[:20000] + "\n</ocr>"})
    content.append({"type": "text", "text": f"学生年级：{args.grade}。可选学科：{args.subjects}（subject 字段用英文枚举）。请按原卷版面把这张照片完整还原为 sheets，保持阅读顺序与格式。"})
    provider = claude.ClaudeProvider(model=os.getenv("ANTHROPIC_MODEL") or "claude-opus-5-5")
    t = time.time()
    out = provider._call(claude.DIGITIZE_SYSTEM_PROMPT, content, claude.DIGITIZE_SCHEMA, max_tokens=32000)
    t_llm = time.time() - t
    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            json.dump({"model": provider.model, "ocr_text": page.text if page else "", "regions": page.regions if page else [], "result": out}, f, ensure_ascii=False, indent=1)

    if page:
        print("=== OCR 文字\n" + page.text + "\nregions=" + json.dumps(page.regions))
    for si, sh in enumerate(out.get("sheets") or []):
        print(f"=== sheet{si} title={sh.get('title')!r} score={sh.get('score')!r} note={sh.get('note')!r}")
        for b in sh.get("blocks") or []:
            print(f"- {b.get('type')} | {b.get('label') or b.get('number') or ''} | {(b.get('text') or '')[:300]!r}")
            if b.get("options"):
                print("  options=" + json.dumps(b["options"], ensure_ascii=False))
            for bl in b.get("blanks") or []:
                print("  blank " + json.dumps({k: bl.get(k) for k in ("id", "student", "mark", "note", "answer")}, ensure_ascii=False))
    print(f"ocr {t_ocr:.1f}s, llm {t_llm:.1f}s, model {provider.model}")


if __name__ == "__main__":
    main()
