"""让 claude-opus-5-5（经 api.tu-zi.com）写 three.js 讲解动画代码，自动检查、修复、渲染成竖屏 MP4。

用法（在 poc 目录下）：
    pip install "anthropic>=0.80"
    export ANTHROPIC_API_KEY=sk-...                 # tu-zi 的 key
    export ANTHROPIC_BASE_URL=https://api.tu-zi.com
    python3 generate.py questions/01-chicken-rabbit.json
    python3 generate.py questions/*.json            # 批量跑，最后打印汇总

每道题输出到 out/<题目文件名>/：attempt-N.js（每一轮代码）、check-N.json（检查结果）、final.mp4 / .jpg / .json、report.json（token、耗时、轮数）。
调用方式和线上识别（server/app/ai/claude.py 的中转模式）一致：标准 Messages 接口 + 流式，不发 beta 头。
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

import anthropic

ROOT = Path(__file__).resolve().parent


def load_server_env() -> None:
    """没设环境变量时，借用 server/.env 里的 tu-zi 配置（和线上识别同一个 key）。"""
    env = ROOT.parent.parent / "server" / ".env"
    if os.getenv("ANTHROPIC_API_KEY") or not env.exists():
        return
    for line in env.read_text(encoding="utf-8").splitlines():
        m = re.match(r"\s*(ANTHROPIC_API_KEY|ANTHROPIC_BASE_URL)\s*=\s*(\S+)", line)
        if m:
            os.environ.setdefault(m.group(1), m.group(2).strip("'\""))


load_server_env()
SYSTEM = (ROOT / os.getenv("PROMPT_FILE", "prompt.md")).read_text(encoding="utf-8")  # PROMPT_FILE=prompt-v3.md 切换提示词
GRADE = {str(i): f"{i} 年级" for i in range(1, 13)}


def user_content(q: dict) -> list[dict]:
    lines = [
        "请为下面这道题写讲解动画。" if q.get("kind", "question") == "question" else "请为下面这个知识点写讲解动画。",
        f"学科：{q.get('subject', 'math')}；孩子年级：{GRADE.get(str(q.get('grade', '')), q.get('grade', ''))}",
    ]
    for key, label in [("stemText", "题目"), ("options", "选项"), ("studentAnswer", "孩子的作答"), ("correctAnswer", "参考答案"),
                       ("analysis", "试卷 / 识别给的解析"), ("knowledgePoints", "知识点"), ("topic", "知识图谱知识点"), ("request", "家长的要求")]:
        v = q.get(key)
        if v:
            lines.append(f"{label}：{json.dumps(v, ensure_ascii=False) if isinstance(v, (list, dict)) else v}")
    content: list[dict] = []
    fig = q.get("figure")  # 插图（几何图、统计图）：本地图片路径
    if fig:
        data = base64.b64encode((ROOT / fig).read_bytes()).decode()
        media = "image/png" if fig.endswith(".png") else "image/jpeg"
        content.append({"type": "image", "source": {"type": "base64", "media_type": media, "data": data}})
        lines.append("题目附带的插图见上图。")
    content.append({"type": "text", "text": "\n".join(lines)})
    return content


def extract_code(text: str) -> str:
    blocks = re.findall(r"```(?:js|javascript)?\s*\n(.*?)```", text, re.S)
    if blocks:
        return max(blocks, key=len)
    if "export default" in text:
        return text
    raise ValueError("模型没有输出代码块")


def check(path: Path, out: Path | None = None) -> dict:
    cmd = ["node", str(ROOT / "render.mjs"), str(path)] + (["--out", str(out)] if out else ["--check"])
    p = subprocess.run(cmd, capture_output=True, text=True, timeout=900)
    try:
        return json.loads(p.stdout)
    except json.JSONDecodeError:
        return {"ok": False, "errors": [p.stdout[-2000:] + p.stderr[-2000:]], "issues": []}


def call(client: anthropic.Anthropic, model: str, messages: list[dict], max_tokens: int, effort: str | None):
    extra = {"extra_body": {"output_config": {"effort": effort}}} if effort else {}
    t = time.time()
    with client.messages.stream(model=model, max_tokens=max_tokens, system=SYSTEM, messages=messages, **extra) as stream:
        msg = stream.get_final_message()
    return msg, time.time() - t


def run(qfile: Path, args) -> dict:
    q = json.loads(qfile.read_text(encoding="utf-8"))
    outdir = ROOT / "out" / (qfile.stem + os.getenv("OUT_SUFFIX", ""))
    outdir.mkdir(parents=True, exist_ok=True)
    client = anthropic.Anthropic(max_retries=2, timeout=900)
    messages: list[dict] = [{"role": "user", "content": user_content(q)}]
    report = {"question": qfile.name, "model": args.model, "rounds": [], "ok": False}

    for rnd in range(1 + args.repairs):
        msg, secs = call(client, args.model, messages, args.max_tokens, args.effort)
        usage = msg.usage
        text = "".join(b.text for b in msg.content if getattr(b, "type", "") == "text")
        info = {"round": rnd, "seconds": round(secs, 1), "stop": msg.stop_reason,
                "input_tokens": usage.input_tokens, "output_tokens": usage.output_tokens}
        report["rounds"].append(info)
        print(f"[{qfile.stem}] 第 {rnd} 轮：{secs:.0f}s，输入 {usage.input_tokens}，输出 {usage.output_tokens}，{msg.stop_reason}", flush=True)
        if msg.stop_reason != "end_turn":
            info["error"] = f"stop_reason={msg.stop_reason}"
            break
        try:
            code = extract_code(text)
        except ValueError as e:
            info["error"] = str(e)
            break
        path = outdir / f"attempt-{rnd}.js"
        path.write_text(code, encoding="utf-8")
        res = check(path)
        (outdir / f"check-{rnd}.json").write_text(json.dumps(res, ensure_ascii=False, indent=2), encoding="utf-8")
        info["errors"], info["issues"] = res.get("errors", []), res.get("issues", [])
        print(f"  检查：{len(info['errors'])} 个错误，{len(info['issues'])} 个画面问题", flush=True)
        if res.get("ok"):
            report["ok"] = True
            break
        # 修复：原样带回模型这一轮的完整回复（含思考块，保持对话只追加），再给检查结果
        problems = "\n".join(f"- {x}" for x in (info["errors"] + info["issues"])[:30])
        messages += [
            {"role": "assistant", "content": msg.content},
            {"role": "user", "content": [{"type": "text", "text": f"渲染检查发现下面的问题，请修正后重新输出**完整**代码（只输出一个 ```js 代码块）：\n{problems}"}]},
        ]

    if report["ok"] or args.render_anyway:
        last = sorted(outdir.glob("attempt-*.js"))[-1] if list(outdir.glob("attempt-*.js")) else None
        if last:
            t = time.time()
            res = check(last, outdir / "final.mp4")
            report["render"] = {"seconds": round(time.time() - t, 1), **res.get("timing", {}), "errors": res.get("errors", [])}
            print(f"  渲染：{report['render']['seconds']}s → {outdir / 'final.mp4'}", flush=True)
    tin = sum(r["input_tokens"] for r in report["rounds"])
    tout = sum(r["output_tokens"] for r in report["rounds"])
    report["tokens"] = {"input": tin, "output": tout, "usd_at_list_price": round(tin * 4e-6 + tout * 20e-6, 3)}
    (outdir / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return report


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("questions", nargs="+", type=Path)
    ap.add_argument("--model", default=os.getenv("VIDEO_MODEL", "claude-opus-5-5"))
    ap.add_argument("--max-tokens", type=int, default=64000)  # tu-zi 按 max_tokens 预扣额度，不要拍满
    ap.add_argument("--effort", default=None, help="low|medium|high|xhigh|max；中转不一定透传，默认不发")
    ap.add_argument("--repairs", type=int, default=2)
    ap.add_argument("--render-anyway", action="store_true", help="检查没通过也渲染最后一版")
    args = ap.parse_args()
    reports = []
    for qf in args.questions:
        try:
            reports.append(run(qf, args))
        except Exception as e:  # noqa: BLE001
            print(f"[{qf.stem}] 失败：{e}", file=sys.stderr)
            reports.append({"question": qf.name, "ok": False, "error": str(e)})
    print("\n汇总")
    for r in reports:
        rounds = len(r.get("rounds", []))
        print(f"  {r['question']}: {'通过' if r.get('ok') else '未通过'}，{rounds} 轮，"
              f"{r.get('tokens', {}).get('usd_at_list_price', '-')} 美元（官方价），渲染 {r.get('render', {}).get('seconds', '-')}s")


if __name__ == "__main__":
    main()
