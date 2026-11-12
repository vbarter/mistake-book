"""DeepSeek 通道：纯文本调用默认走 DeepSeek，带图片的留在原通道，一条失败换另一条。"""
import json

import httpx
import pytest

IMAGE = {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": "QUJD"}}
TEXT = {"type": "text", "text": "第 1 题：1+1=?"}


def _sse(*pieces, finish="stop", reasoning="先想一想"):
    lines = [": keep-alive", ""]
    if reasoning:
        lines += ["data: " + json.dumps({"choices": [{"delta": {"reasoning_content": reasoning}, "finish_reason": None}]}), ""]
    for p in pieces:
        lines += ["data: " + json.dumps({"choices": [{"delta": {"content": p}, "finish_reason": None}]}), ""]
    lines += ["data: " + json.dumps({"choices": [{"delta": {}, "finish_reason": finish}]}), "", "data: [DONE]", ""]
    return httpx.Response(200, text="\n".join(lines), headers={"content-type": "text/event-stream"})


def _error(status, message="boom"):
    return httpx.Response(status, json={"error": {"message": message}})


@pytest.fixture
def make(monkeypatch):
    """造一个两条通道都配了的 provider：DeepSeek 用假的 HTTP 应答，Anthropic 通道用假的 _call_anthropic。"""
    from app.ai import claude

    def build(responses, **env):
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
        monkeypatch.setenv("ANTHROPIC_BASE_URL", "https://api.tu-zi.com")
        monkeypatch.setenv("DEEPSEEK_API_KEY", "sk-deepseek-test")
        for k in ("DEEPSEEK_BASE_URL", "DEEPSEEK_MODEL", "DEEPSEEK_VISION", "DEEPSEEK_MAX_TOKENS", "DEEPSEEK_REASONING_EFFORT", "DIGITIZE_TEXT_ONLY", "LLM_DEFAULT", "LLM_FALLBACK"):
            monkeypatch.delenv(k, raising=False)
        for k, v in env.items():
            monkeypatch.setenv(k, v)
        monkeypatch.setattr(claude, "RETRY_DELAY", 0)
        provider = claude.ClaudeProvider(model="gpt-6.1-sol")
        queue = list(responses)
        provider.requests = []
        provider.anthropic_calls = []

        def handler(request):
            provider.requests.append(request)
            r = queue.pop(0)
            if isinstance(r, Exception):
                raise r
            return r

        provider.deepseek.http = httpx.Client(transport=httpx.MockTransport(handler), headers=provider.deepseek.http.headers)

        def fake_anthropic(system, content, schema, max_tokens=16000, on_text=None):
            provider.anthropic_calls.append(content)
            return {"from": "anthropic"}

        monkeypatch.setattr(provider, "_call_anthropic", fake_anthropic)
        return provider

    return build


def test_without_key_there_is_no_deepseek_channel(monkeypatch):
    from app.ai.claude import ClaudeProvider

    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setenv("ANTHROPIC_BASE_URL", "https://api.tu-zi.com")
    monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
    provider = ClaudeProvider(model="gpt-6.1-sol")
    assert provider.deepseek is None and provider.name == "claude-relay"
    assert provider._channels([TEXT]) == ["anthropic"]


def test_text_call_goes_to_deepseek_by_default(make):
    provider = make([_sse('{"results": ', '[{"key": "q0"}]}')])
    seen = []
    out = provider._call("你是老师", [TEXT, {"type": "text", "text": "第 2 题"}], {"type": "object"}, max_tokens=4000, on_text=seen.append)
    assert out == {"results": [{"key": "q0"}]}
    assert provider.anthropic_calls == [] and provider.name == "deepseek+claude-relay"
    req = provider.requests[0]
    assert str(req.url) == "https://api.deepseek.com/chat/completions"
    assert req.headers["authorization"] == "Bearer sk-deepseek-test"
    body = json.loads(req.content)
    assert body["model"] == "deepseek-v4-pro" and body["stream"] is True
    assert body["response_format"] == {"type": "json_object"}
    assert body["max_tokens"] == 32000  # 思考也算输出，给个下限
    assert body["messages"][0] == {"role": "system", "content": "你是老师"}
    user = body["messages"][1]["content"]
    assert isinstance(user, str) and "第 1 题" in user and "第 2 题" in user and "JSON Schema" in user
    # 进度只按正文算，思考过程不算
    assert seen == [len('{"results": '), len('{"results": [{"key": "q0"}]}')]


def test_image_call_stays_on_anthropic_channel(make):
    provider = make([])
    assert provider._call("s", [IMAGE, TEXT], {}) == {"from": "anthropic"}
    assert provider.requests == [] and len(provider.anthropic_calls) == 1


def test_image_call_can_go_to_deepseek_when_vision_enabled(make):
    provider = make([_sse('{"ok": true}')], DEEPSEEK_VISION="1")
    assert provider._call("s", [IMAGE, TEXT], {}) == {"ok": True}
    parts = json.loads(provider.requests[0].content)["messages"][1]["content"]
    assert parts[0] == {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64,QUJD"}}
    assert parts[1]["type"] == "text"


def test_llm_default_anthropic_switches_back(make):
    provider = make([], LLM_DEFAULT="anthropic")
    assert provider._call("s", [TEXT], {}) == {"from": "anthropic"}
    assert provider.requests == [] and provider.name == "claude-relay+deepseek"


def test_transient_error_retries_once_then_succeeds(make):
    provider = make([_error(503), _sse('{"ok": true}')])
    assert provider._call("s", [TEXT], {}) == {"ok": True}
    assert len(provider.requests) == 2 and provider.anthropic_calls == []


@pytest.mark.parametrize("responses", [
    [_error(401, "Authentication Fails")],  # 密钥不对：不重试，直接换通道
    [_error(400, "Model Not Exist")],
    [_error(500), _error(500)],  # 重试一次还不行
    [httpx.ConnectError("no route"), httpx.ConnectError("no route")],
    [_sse('{"ok": ', finish="length")],  # 被截断
    [_sse("抱歉，我没法输出")],  # 不是 JSON
])
def test_failure_falls_back_to_anthropic(make, responses):
    provider = make(responses)
    assert provider._call("s", [TEXT], {}) == {"from": "anthropic"}
    assert len(provider.requests) == len(responses) and len(provider.anthropic_calls) == 1


def test_anthropic_failure_falls_back_to_deepseek_for_text(make, monkeypatch):
    from app.ai.base import AIError

    provider = make([_sse('{"ok": true}')], LLM_DEFAULT="anthropic")

    def broken(*a, **k):
        raise AIError("AI 服务暂时不可用，题目已保留，稍后可重试")

    monkeypatch.setattr(provider, "_call_anthropic", broken)
    assert provider._call("s", [TEXT], {}) == {"ok": True}
    # 带图片的没有别的通道可换，原样报错
    with pytest.raises(AIError):
        provider._call("s", [IMAGE], {})


def test_no_fallback_when_disabled(make):
    from app.ai.base import AIError

    provider = make([_error(401)], LLM_FALLBACK="0")
    with pytest.raises(AIError, match="DEEPSEEK_API_KEY"):
        provider._call("s", [TEXT], {})
    assert provider.anthropic_calls == []


def test_channel_order(make):
    provider = make([])
    assert provider._channels([TEXT]) == ["deepseek", "anthropic"]
    assert provider._channels([IMAGE, TEXT]) == ["anthropic"]


@pytest.mark.parametrize("key", ["你的密钥", "sk-7b50e•••••••", "sk-abc def"])
def test_malformed_key_disables_channel_instead_of_crashing(monkeypatch, key):
    """.env 里填了占位符或被打码的密钥：不启用 DeepSeek，服务照常走原通道（以前会在建 HTTP 客户端时抛 UnicodeEncodeError，/api/health 都 500）。"""
    from app.ai.claude import ClaudeProvider

    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setenv("ANTHROPIC_BASE_URL", "https://api.tu-zi.com")
    monkeypatch.setenv("DEEPSEEK_API_KEY", key)
    provider = ClaudeProvider(model="gpt-6.1-sol")
    assert provider.deepseek is None and provider.name == "claude-relay"


# ---------- 纯文字链路：OCR 认题目和手写，DeepSeek 只拿文字解题、批改 ----------

SHEET = {"sheets": [{"label": "p1", "blocks": [{"type": "item", "number": "4", "questionType": "solve", "text": "刷完这面墙一共要用多少千克涂料？[[4]]", "blanks": [{"id": "4", "student": "7.2", "mark": "unmarked", "answer": "7.2 千克"}]}]}]}


def _digitize(provider, monkeypatch, ocr_text="4 粉刷如下图所示的一面墙\n[手写] 48×0.15=7.2"):
    """跑一次整页还原，返回每次大模型调用的 content（不走网络：_call 换成假的，但通道选择仍用真的 _channels）。"""
    from app.ai import ocr
    from app.ai.base import Crop

    monkeypatch.setattr("app.ai.claude.ocr.enabled", lambda: ocr_text is not None)
    monkeypatch.setattr(ocr, "ocr_page", lambda data, media_type="image/jpeg", **kw: ocr.OcrPage(text=ocr_text or ""))
    calls = []

    def fake_call(system, content, schema, max_tokens=16000, on_text=None):
        calls.append({"system": system, "content": content, "channels": provider._channels(content)})
        return SHEET if "sheets" in schema.get("properties", {}) else {"results": []}

    monkeypatch.setattr(provider, "_call", fake_call)
    sheets, _ = provider.digitize_pages([Crop(data=b"img")], subjects=["math"], grade="5")
    return calls, sheets


def test_digitize_sends_only_ocr_text_to_deepseek(make, monkeypatch):
    from app.ai import claude

    provider = make([])
    assert provider.text_only is True
    calls, sheets = _digitize(provider, monkeypatch)
    page = calls[0]
    assert not any(c.get("type") == "image" for c in page["content"])
    texts = "\n".join(c["text"] for c in page["content"])
    assert "<ocr>" in texts and "[手写] 48×0.15=7.2" in texts and claude.TEXT_ONLY_DIGITIZE_NOTE in texts
    assert page["channels"][0] == "deepseek"
    assert sheets[0].blocks[0].blanks[0].student == "7.2"
    # 后面的阅卷、讲解等步骤也都不带照片
    assert all(not any(c.get("type") == "image" for c in call["content"]) for call in calls)


def test_digitize_keeps_photo_when_ocr_has_no_text(make, monkeypatch):
    provider = make([])
    for text in (None, "  "):  # OCR 没开 / OCR 没认出字
        calls, _ = _digitize(provider, monkeypatch, ocr_text=text)
        assert any(c.get("type") == "image" for c in calls[0]["content"])
        assert calls[0]["channels"] == ["anthropic"]


@pytest.mark.parametrize("env", [{"DIGITIZE_TEXT_ONLY": "0"}, {"DEEPSEEK_VISION": "1"}])
def test_text_only_can_be_turned_off(make, monkeypatch, env):
    provider = make([], **env)
    assert provider.text_only is False
    calls, _ = _digitize(provider, monkeypatch)
    assert any(c.get("type") == "image" for c in calls[0]["content"])


def test_text_only_needs_deepseek(monkeypatch):
    from app.ai import claude

    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setenv("ANTHROPIC_BASE_URL", "https://api.tu-zi.com")
    monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
    assert claude.ClaudeProvider(model="gpt-6.1-sol").text_only is False


def test_page_images_skips_pages_that_have_ocr(make):
    from app.ai import claude
    from app.ai.base import Crop

    provider = make([])
    content, skipped = provider._page_images([Crop(data=b"a"), Crop(data=b"b")], (0, 1), {0: "第一页的字"})
    assert skipped and [c["type"] for c in content] == ["text", "image", "text"]
    assert "第 2 张照片" in content[0]["text"] and content[-1]["text"] == claude.TEXT_ONLY_SOLVE_NOTE


def test_needs_figure_blank_is_not_graded(make, monkeypatch):
    """要看图才能做的题（answer = 需看图）不送阅卷；作答读不清（verdict = unclear）的保持 unmarked。"""
    from app.ai.digitize import sheets_from_dicts

    provider = make([])
    sheets = sheets_from_dicts([{"page": 0, "label": "p1", "blocks": [
        {"type": "item", "number": "3", "questionType": "solve", "text": "求涂色部分的面积 [[3]]", "blanks": [{"id": "3", "student": "96", "mark": "unmarked", "answer": "需看图"}]},
        {"type": "item", "number": "4", "questionType": "solve", "text": "一共要用多少千克？[[4]]", "blanks": [{"id": "4", "student": "72□2", "mark": "unmarked", "answer": "7.2"}]},
    ]}])
    seen = []

    def fake_call(system, content, schema, max_tokens=16000, on_text=None):
        seen.append(content[0]["text"])
        return {"results": [{"key": "s0b1#4", "answer": "7.2", "verdict": "unclear", "analysis": ""}]}

    monkeypatch.setattr(provider, "_call", fake_call)
    assert provider.grade_unmarked(sheets, grade="5") == 0
    assert "求涂色部分" not in seen[0].split("<ocr>")[0] and "手写 OCR" in seen[0]
    assert [b.mark for blk in sheets[0].blocks for b in blk.blanks] == ["unmarked", "unmarked"]


def test_reasoning_effort_defaults_to_none(make):
    provider = make([_sse('{"ok": true}'), _sse('{"ok": true}')])
    provider._call("sys", [TEXT], {"type": "object"})
    assert json.loads(provider.requests[0].content)["reasoning_effort"] == "none"


@pytest.mark.parametrize("value, sent", [("high", "high"), ("default", None)])
def test_reasoning_effort_env(make, value, sent):
    provider = make([_sse('{"ok": true}')], DEEPSEEK_REASONING_EFFORT=value)
    provider._call("sys", [TEXT], {"type": "object"})
    assert json.loads(provider.requests[0].content).get("reasoning_effort") == sent
