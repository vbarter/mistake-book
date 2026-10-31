"""本地 Mock Provider：无需任何 API Key 即可跑通全部流程。

识别：按截图顺序循环返回四道示例题（与 PRD 原型一致）。
变式：数学题替换数字生成同类题；其他学科返回预置的同类变式。
"""
from __future__ import annotations

import random
import re

from .base import AIProvider, Crop, DigitizedBlank, DigitizedBlock, DigitizedPage, RecognizedItem, ScannedItem, Variant
from .digitize import derive_questions

# 示例试卷（app/public/sample-paper.svg，1200×1700）上三道错题的归一化位置
SAMPLE_BBOXES = [
    [0.06, 0.15, 0.95, 0.24],
    [0.06, 0.30, 0.95, 0.44],
    [0.06, 0.50, 0.95, 0.57],
]

SAMPLES = [
    RecognizedItem(
        subject="math",
        knowledgePoints=["分数乘法", "单位“1”"],
        stemText="一根绳子长 24 米，第一次用去全长的 3/8，第二次用去剩下的 1/3。两次共用去多少米？",
        questionType="solve",
        uncertainSpans=["3/8"],
        studentAnswer="24 × 3/8 = 9（米）　9 + 24 × 1/3 = 17（米）",
        correctAnswer="14 米",
        analysis="第一次用去 24 × 3/8 = 9 米；剩下 24 − 9 = 15 米；第二次用去的是「剩下的」1/3：15 × 1/3 = 5 米。两次共 9 + 5 = 14 米。",
        tip="下次遇到同类题，先圈出「剩下的」「全长的」，再确定每一步的单位“1”。",
    ),
    RecognizedItem(
        subject="chinese",
        knowledgePoints=["病句辨析", "成分残缺"],
        stemText="下列句子没有语病的一项是（　　）",
        questionType="choice",
        options=["通过这次读书节，使我爱上了阅读。", "我们要养成认真完成作业的好习惯。", "他大约有十二岁左右。"],
        studentAnswer="A",
        correctAnswer="B",
        analysis="A 句「通过……使……」缺少主语；C 句「大约」与「左右」语义重复。B 句主谓宾完整，没有语病。",
        tip="判断病句先找主语和谓语，再看有没有重复或矛盾的词。",
    ),
    RecognizedItem(
        subject="english",
        knowledgePoints=["一般过去时", "规则动词"],
        stemText="She ___ (visit) her grandparents last weekend.",
        questionType="fill",
        studentAnswer="visits",
        correctAnswer="visited",
        analysis="last weekend 表示过去的时间，句子要用一般过去时，visit 是规则动词，过去式直接加 -ed。",
        tip="看到 last / ago / yesterday 这些时间词，先想到过去时。",
    ),
    RecognizedItem(
        subject="science",
        knowledgePoints=["浮力", "物体浮沉"],
        stemText="把一块橡皮泥捏成小船放入水中会漂浮，团成一团则下沉。这说明物体的浮沉与什么有关？",
        questionType="solve",
        studentAnswer="与重量有关",
        correctAnswer="与物体排开水的体积（形状）有关",
        analysis="橡皮泥的重量没变，捏成船后排开的水更多，受到的浮力更大，所以能漂浮。",
        tip="浮沉看的是浮力和重力谁大，浮力又取决于排开水的多少。",
    ),
]

VARIANT_LIBRARY = {
    "chinese": [
        Variant(
            question="下列句子中没有语病的一项是（　　）",
            questionType="choice",
            options=["经过老师的讲解，使我明白了这道题。", "春天的公园里开满了五颜六色的红花。", "我们应该爱护校园里的一草一木。"],
            answer="C",
            analysis="A 缺主语；B「五颜六色」与「红花」矛盾；C 没有语病。",
        ),
        Variant(
            question="下列句子中有语病的一项是（　　）",
            questionType="choice",
            options=["他认真地完成了作业。", "听了这个故事，我深受感动。", "能否坚持锻炼，是身体健康的保证。"],
            answer="C",
            analysis="C 句「能否」是两面，「保证」是一面，前后不一致。",
        ),
    ],
    "english": [
        Variant(
            question="They ___ (play) football in the park yesterday afternoon.",
            questionType="fill",
            options=[],
            answer="played",
            analysis="yesterday afternoon 是过去时间，用一般过去时，play 加 -ed。",
        ),
        Variant(
            question="My father ___ (watch) TV last night.",
            questionType="fill",
            options=[],
            answer="watched",
            analysis="last night 表过去，watch 以 ch 结尾直接加 -ed。",
        ),
    ],
    "science": [
        Variant(
            question="同样重的两块橡皮泥，一块捏成碗形，一块揉成球，放入水中，哪个更容易漂浮？为什么？",
            questionType="solve",
            options=[],
            answer="碗形的更容易漂浮，因为它排开的水更多，受到的浮力更大。",
            analysis="物体浮沉取决于浮力与重力的大小，浮力大小与排开水的体积有关。",
        ),
        Variant(
            question="下列做法中，能让下沉的物体浮起来的是（　　）",
            questionType="choice",
            options=["把它压得更紧", "把它做成空心", "把它放到更深的水里"],
            answer="B",
            analysis="做成空心后排开的水变多，浮力变大。",
        ),
    ],
}


def _math_variants(stem: str, count: int) -> list[Variant]:
    numbers = re.findall(r"\d+", stem)
    variants: list[Variant] = []
    rnd = random.Random(stem)
    for i in range(count):
        if numbers and "绳子" in stem:
            total = rnd.choice([32, 40, 48, 56])
            first = f"{total * 3 // 8}"
            rest = total - total * 3 // 8
            q = f"一根绳子长 {total} 米，第一次用去全长的 3/8，第二次用去剩下的 1/4。两次共用去多少米？"
            ans = total * 3 // 8 + rest // 4
            variants.append(
                Variant(
                    question=q,
                    questionType="solve",
                    options=[],
                    answer=f"{ans} 米",
                    analysis=f"第一次用去 {total} × 3/8 = {first} 米；剩下 {rest} 米；第二次用去 {rest} × 1/4 = {rest // 4} 米；共 {ans} 米。",
                )
            )
        elif "面积" in stem or "半径" in stem:
            r = rnd.choice([2, 4, 5])
            variants.append(
                Variant(
                    question=f"一个圆的半径是 {r} 厘米，它的面积是多少平方厘米？（π 取 3.14）",
                    questionType="solve",
                    options=[],
                    answer=f"{3.14 * r * r:.2f} 平方厘米",
                    analysis=f"S = πr² = 3.14 × {r} × {r} = {3.14 * r * r:.2f}。",
                )
            )
        else:
            a, b = rnd.choice([(3, 5), (2, 7), (4, 9)])
            variants.append(
                Variant(
                    question=f"一袋米重 {a * 10} 千克，吃了 {b}/10，还剩多少千克？",
                    questionType="choice",
                    options=[f"{a * b} 千克", f"{a * 10 - a * b} 千克", f"{a * 10 + a * b} 千克"],
                    answer="B",
                    analysis=f"吃了 {a * 10} × {b}/10 = {a * b} 千克，还剩 {a * 10 - a * b} 千克。",
                )
            )
    return variants


class MockProvider(AIProvider):
    name = "mock"

    def recognize(self, crops: list[Crop], subjects: list[str], grade: str) -> list[RecognizedItem]:
        pool = [s for s in SAMPLES if s.subject in subjects] or SAMPLES
        items: list[RecognizedItem] = []
        for i, crop in enumerate(crops):
            sample = pool[i % len(pool)]
            item = RecognizedItem(**sample.to_dict())
            if crop.hint:
                item.stemText = crop.hint
            items.append(item)
        return items

    def scan_pages(self, pages: list[Crop], subjects: list[str], grade: str) -> list[ScannedItem]:
        pool = [s for s in SAMPLES[:3] if s.subject in subjects] or SAMPLES[:3]
        items: list[ScannedItem] = []
        for p, _page in enumerate(pages):
            for i, sample in enumerate(pool):
                items.append(ScannedItem(**sample.to_dict(), page=p, bbox=SAMPLE_BBOXES[i % len(SAMPLE_BBOXES)], reason="有红叉"))
        return items

    def digitize_pages(self, pages: list[Crop], subjects: list[str], grade: str, region: str = "", on_page_done=None, on_page_start=None, on_page_progress=None):
        """示例试卷的版面块电子版：两个大题 + 一篇带内嵌空格的短文，共派生 7 题（1 半对 / 3 错 / 3 对）。"""
        sheets: list[DigitizedPage] = []
        for p in range(len(pages)):
            s0, s1, s2 = SAMPLES[0], SAMPLES[1], SAMPLES[2]
            blocks = [
                DigitizedBlock(type="section", label="一", title="填空题", instruction="把答案填在横线上", points="每题 4 分，共 12 分", bbox=[0.06, 0.10, 0.95, 0.14]),
                DigitizedBlock(type="item", number="1", text=s0.stemText + " [[1]]", subject=s0.subject, questionType="solve", bbox=SAMPLE_BBOXES[0], knowledgePoints=list(s0.knowledgePoints), tip=s0.tip, uncertainSpans=list(s0.uncertainSpans), blanks=[DigitizedBlank(id="1", number="1", student=s0.studentAnswer, mark="partial", note="半对半错", answer=s0.correctAnswer, analysis=s0.analysis)]),
                DigitizedBlock(type="item", number="2", text=s1.stemText.replace("（　　）", "（[[2]]）"), options=list(s1.options), subject=s1.subject, questionType="choice", bbox=SAMPLE_BBOXES[1], knowledgePoints=list(s1.knowledgePoints), tip=s1.tip, blanks=[DigitizedBlank(id="2", number="2", student=s1.studentAnswer, mark="wrong", note="✗", answer=s1.correctAnswer, analysis=s1.analysis)]),
                DigitizedBlock(type="item", number="3", text="She [[3]] her grandparents last weekend.", hint="(visit)", subject=s2.subject, questionType="fill", bbox=SAMPLE_BBOXES[2], knowledgePoints=list(s2.knowledgePoints), tip=s2.tip, blanks=[DigitizedBlank(id="3", number="3", student=s2.studentAnswer, mark="wrong", note="✗", answer=s2.correctAnswer, analysis=s2.analysis)]),
                DigitizedBlock(type="section", label="二", title="选词填空", instruction="从方框中选出合适的词填入短文，每词限用一次", points="共 4 分", bbox=[0.06, 0.58, 0.95, 0.62]),
                DigitizedBlock(type="wordbank", options=["A. 因为", "B. 所以", "C. 虽然", "D. 但是"], bbox=[0.06, 0.62, 0.95, 0.66]),
                DigitizedBlock(type="passage", label="(A)", text="今天下雨了，[[4]]我们没有去春游。[[5]]有点遗憾，大家还是在教室里玩得很开心。", subject="chinese", questionType="choice", bbox=[0.06, 0.66, 0.95, 0.80], knowledgePoints=["关联词"], tip="先读完整句再选词", blanks=[DigitizedBlank(id="4", number="4", student="A", mark="wrong", note="✗", answer="B", analysis="前句说了原因「下雨」，后句是结果，要用「所以」。"), DigitizedBlank(id="5", number="5", student="C", mark="correct", note="✓")]),
                DigitizedBlock(type="section", label="三", title="解答题", points="共 10 分", bbox=[0.06, 0.82, 0.95, 0.85]),
                DigitizedBlock(type="item", number="6", text="一个圆的半径是 3 厘米，它的面积是多少？列式：[[6-1]]　答：[[6-2]]", subject="math", questionType="solve", bbox=[0.06, 0.85, 0.95, 0.92], blanks=[DigitizedBlank(id="6-1", number="6", student="3.14 × 3² = 28.26", mark="correct", note="✓"), DigitizedBlank(id="6-2", number="6", student="28.26 平方厘米", mark="correct")]),
                DigitizedBlock(type="item", number="7", text="用“因为……所以……”造句。[[7]]", subject="chinese", questionType="solve", bbox=[0.06, 0.92, 0.95, 0.98], blanks=[DigitizedBlank(id="7", number="7", student="因为今天下雨，所以我们没有去春游。", mark="correct", note="✓")]),
                DigitizedBlock(type="text", text="第 1 页 共 1 页", bbox=[0.40, 0.98, 0.60, 1.0]),
            ]
            sheets.append(DigitizedPage(page=p, label=f"第 {p + 1} 页", title="五年级随堂练习", score="82", note="订正提醒：注意题目中的“剩下的”和“last weekend”，它们会影响解题方法。", subject="math", examLevel="日常练习", examGrade="五年级", region="", syllabus="小学五年级课标", blocks=blocks))
        from .. import taxonomy

        if taxonomy.enabled():
            self.tag_topics(sheets, grade)
        return sheets, derive_questions(sheets)

    def tag_topics(self, sheets: list[DigitizedPage], grade: str) -> int:
        """本地演示：按自由文本知识点和图谱知识点名称的字面重合挑一个（真实环境由大模型按题意挑）。"""
        from .. import taxonomy
        from .digitize import apply_topic, tag_targets

        done = 0
        for si, bi in tag_targets(sheets):
            blk = sheets[si].blocks[bi]
            subject = blk.subject or sheets[si].subject
            best, score = None, 0
            for t in taxonomy.candidates(subject, grade):
                for kp in blk.knowledgePoints:
                    alias = taxonomy.resolve_alias(subject, kp)
                    if alias == t["id"]:
                        best, score = t["id"], 99
                    elif t["name"] and (t["name"] in kp or kp in t["name"]):
                        n = min(len(t["name"]), len(kp))
                        if n > score:
                            best, score = t["id"], n
            if best and apply_topic(blk, best):
                done += 1
        return done

    def generate_variants(self, mistake: dict, count: int = 2) -> list[Variant]:
        subject = mistake.get("subject", "math")
        if subject == "math":
            return _math_variants(mistake.get("stemText", ""), count)
        library = VARIANT_LIBRARY.get(subject, VARIANT_LIBRARY["chinese"])
        return [Variant(**v.to_dict()) for v in library[:count]]
