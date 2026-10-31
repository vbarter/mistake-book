from conftest import TINY_PNG

from app.ai.digitize import clean_sheets, derive_questions
from app.ai.prints import hamming, normalize


def _sheet(items, student=""):
    blocks = [{"type": "item", "number": n, "text": f"{n}. {t} [[{n}]]", "subject": "math", "questionType": "fill", "blanks": [{"id": n, "student": student, "mark": "wrong"}]} for n, t in items]
    blocks.append({"type": "passage", "subject": "english", "text": "Tom [[21]] to school every day and he [[22]] his teacher.", "blanks": [{"id": "21", "student": student}, {"id": "22", "student": student}]})
    return clean_sheets({"sheets": [{"blocks": blocks}]}, 0)


def test_normalize_ignores_blanks_width_and_numbering():
    assert normalize("（3）计算：$\\frac{1}{2}$ + ３ = [[3]]") == normalize("3. 计算: 1/2+3= ____")


def test_question_prints_ignore_answers_and_distinguish_numbers():
    a = _sheet([("1", "计算 35 + 47 等于多少"), ("2", "一个长方形长 8 厘米宽 5 厘米，求周长")])
    b = _sheet([("1", "计算 35 + 47 等于多少"), ("2", "一个长方形长 8 厘米宽 5 厘米，求周长")], student="82")
    c = _sheet([("1", "计算 35 + 48 等于多少")])
    qa, qb, qc = derive_questions(a), derive_questions(b), derive_questions(c)
    assert [q.qKey for q in qa] == [q.qKey for q in qb]  # 作答不同，题目指纹相同
    assert a[0].textSim == b[0].textSim and a[0].textSim
    assert qa[0].qKey != qc[0].qKey and qa[0].qNums != qc[0].qNums  # 数字不同就是不同的题
    assert hamming(qa[0].qSim, qc[0].qSim) < 32
    passage = [q for q in qa if q.subject == "english"]
    assert len(passage) == 2 and passage[0].qKey != passage[1].qKey  # 同一篇短文的不同空
    assert passage[0].qNums.startswith("#21")


def test_prints_endpoint_backfills_old_papers(client, auth):
    body = client.post("/api/digitize", json={"pages": [{"image": TINY_PNG}]}, headers=auth).get_json()["result"]
    assert all("qKey" in q for q in body["questions"]) and "textSim" in body["pages"][0]
    old_pages = [{k: v for k, v in p.items() if k != "textSim"} for p in body["pages"]]
    r = client.post("/api/digitize/prints", json={"pages": old_pages}, headers=auth)
    assert r.status_code == 200
    out = r.get_json()
    assert [q["qKey"] for q in out["questions"]] == [q["qKey"] for q in body["questions"]]
    assert out["pages"][0]["textSim"] == body["pages"][0]["textSim"]
    assert client.post("/api/digitize/prints", json={"pages": []}, headers=auth).status_code == 400
