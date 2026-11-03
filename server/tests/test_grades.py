"""解题方法要和学生年级匹配：年级优先级、学段解法要求、越界检查和重写。"""
from app.ai import grades
from app.ai.base import Crop
from app.ai.digitize import clean_sheets


def _sheets(exam_grade="", guessed=""):
    return clean_sheets({"sheets": [{"label": "第1页", "subject": "math", "examGrade": exam_grade, "guessedGrade": guessed, "blocks": [
        {"type": "item", "number": "6", "questionType": "fill", "subject": "math",
         "text": "一个数的小数点向右移动两位后，比原数大 401.94，原数是 [[6]]。",
         "blanks": [{"id": "6", "number": "6", "student": "", "mark": "blank", "answer": "4.06"}]},
    ]}]}, 0)


def test_resolve_priority_paper_then_profile_then_guess():
    # 1. 卷头印的年级优先
    assert grades.resolve(_sheets("五年级下册", "8"), "9") == (5, "paper")
    # 2. 卷面没印 → App 里设的
    assert grades.resolve(_sheets("", "8"), "4") == (4, "profile")
    # 3. 都没有 → 模型按题目判断的
    assert grades.resolve(_sheets("", "五年级"), "") == (5, "guess")
    assert grades.resolve(_sheets("", ""), "") == (None, "")
    assert _sheets("", "约 5 年级")[0].guessedGrade == "5"


def test_rules_and_labels_by_stage():
    assert grades.label(5) == "五年级" and grades.label("11") == "高二" and grades.label("") == ""
    assert "算术" in grades.method_rules(3) and "不要用字母表示未知数" in grades.method_rules(3)
    assert "增加量 ÷ 99" in grades.method_rules(5) and "合并同类项" in grades.method_rules(5)
    assert "导数" in grades.method_rules(8) and "洛必达" in grades.method_rules(11)
    assert "年级不确定" in grades.method_rules(None)
    note = grades.grade_note(5, "paper")
    assert note.startswith("学生年级：五年级（试卷上印的年级）。")


def test_check_methods_flags_bad_case():
    bad = {
        "thinking": "先把原数设为未知数，再列方程。",
        "steps": ["设原数为x。", "∵ 小数点向右移动两位，∴ 新数为 100x。", "100x-x=401.94", "合并同类项：99x=401.94", "答：原数是4.06。"],
        "technique": "",
    }
    good = {
        "thinking": "小数点向右移动两位，新数是原数的 100 倍，比原数多 99 倍。",
        "steps": ["新数比原数多的部分是原数的 100 − 1 = 99 倍", "原数：$401.94 \\div 99 = 4.06$", "答：原数是 4.06。"],
        "technique": "原数 = 增加量 ÷ 增加的倍数",
    }
    found = grades.check_methods(5, grades.explanation_text(bad))
    assert "用了「∵」「∴」符号" in found and any("合并同类项" in x for x in found)
    assert grades.check_methods(3, "设原数为 $x$")  # 三年级不能设未知数
    assert grades.check_methods(5, grades.explanation_text(good)) == []
    assert grades.check_methods(8, "∵ AB=AC，∴ ∠B=∠C；设原数为 x，列方程") == []  # 初中正常写法
    assert grades.check_methods(8, "对函数求导得 $f'(x)=2x$")
    assert grades.check_methods(None, "∵∴ 导数") == []  # 不知道年级不查
    assert grades.check_methods(5, "长方形面积分别是 12 和 20") == []  # 「面积分别」不是积分


def test_explain_sends_grade_and_rewrites_over_grade(monkeypatch):
    from app.ai.claude import ClaudeProvider

    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    provider = ClaudeProvider(model="claude-sonnet-4-5")
    sheets = _sheets("", "")
    calls = []
    algebra = {"key": "q0", "answer": "4.06", "thinking": "设原数为未知数列方程", "knowledge": ["小数点移动"],
               "steps": ["设原数为x", "∵ 新数为 100x ∴ 100x-x=401.94", "合并同类项 99x=401.94", "答：4.06"], "technique": "", "pitfall": "", "wrongAt": ""}
    arithmetic = {"key": "q0", "answer": "4.06", "thinking": "新数是原数的 100 倍，多出 99 倍", "knowledge": ["小数点移动"],
                  "steps": ["多出的部分是原数的 100 − 1 = 99 倍", "$401.94 \\div 99 = 4.06$", "答：原数是 4.06。"], "technique": "原数 = 增加量 ÷ 99", "pitfall": "", "wrongAt": ""}

    def fake_call(system, content, schema, max_tokens=16000, on_text=None):
        calls.append([c.get("text", "") for c in content if c.get("type") == "text"])
        return {"results": [algebra if len(calls) == 1 else arithmetic]}

    monkeypatch.setattr(provider, "_call", fake_call)
    assert provider.explain(sheets, [Crop(data=b"x")], grade="5") == 1
    first = "\n".join(calls[0])
    assert "学生年级：五年级（家长在 App 里设置的年级）" in first and "增加量 ÷ 99" in first
    assert len(calls) == 2 and "超出学生年级" in calls[1][-1] and "q0" in calls[1][-1]
    analysis = sheets[0].blocks[0].blanks[0].analysis
    assert "401.94 \\div 99" in analysis and "∵" not in analysis and "设原数为x" not in analysis


def test_explain_keeps_good_answer_without_retry(monkeypatch):
    from app.ai.claude import ClaudeProvider

    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    provider = ClaudeProvider(model="claude-sonnet-4-5")
    sheets = _sheets("九年级", "")
    calls = []

    def fake_call(system, content, schema, max_tokens=16000, on_text=None):
        calls.append(content)
        return {"results": [{"key": "q0", "answer": "4.06", "thinking": "列方程", "knowledge": ["一元一次方程"],
                             "steps": ["设原数为 $x$", "∵ 新数为 $100x$，∴ $99x=401.94$", "答：4.06"], "technique": "", "pitfall": "", "wrongAt": ""}]}

    monkeypatch.setattr(provider, "_call", fake_call)
    assert provider.explain(sheets, [Crop(data=b"x")], grade="5") == 1
    assert len(calls) == 1  # 卷面九年级优先于 App 的五年级，方程写法不算越界
    assert "学生年级：九年级（试卷上印的年级）" in calls[0][-1]["text"]


def test_new_user_without_grade(client):
    r = client.post("/api/auth/guest", json={"profile": {}})
    assert r.status_code == 200 and r.get_json()["user"]["grade"] == ""
