"""Claude Provider：用视觉模型一次完成 OCR、学科归类、知识点标注、答案与解析。

两种工作方式：
- 官方 API（默认）：结构化输出（JSON Schema）+ 服务端回退。
- 中转模式（设置 ANTHROPIC_BASE_URL 指向 api.tu-zi.com 等 new-api 中转时自动启用）：
  只用标准 Messages 接口，不带 beta 头 / output_config / fallbacks，由提示词约束 JSON 并稳健解析。
"""
from __future__ import annotations

import base64
import json
import logging
import math
import os
import re

import anthropic

from ..constants import QUESTION_TYPES, SUBJECT_LABELS, SUBJECTS
from .base import BLOCK_TYPES, AIError, AIProvider, Crop, DigitizedBlank, DigitizedPage, RecognizedItem, ScannedItem, Variant
from . import ocr
from . import queue as page_queue
from .digitize import _nearby_wordbank, _render_text, clean_sheets, derive_questions, drop_ghost_sheets, snap_figures, unreadable

log = logging.getLogger(__name__)

SYSTEM_PROMPT = (
    "你是一位小学教师助手，帮助学生整理错题。你会收到试卷上框选出的错题截图。"
    "请逐张截图提取题目原文（保留分数、公式与选项的原始写法），识别学生写的作答，"
    "判断学科，标注 1 到 3 个知识点（用课本常见说法，按年级分层），给出正确答案、"
    "面向小学生的简短解析（不超过 120 字），以及一句「下次注意」提示。"
    "题干中你看不清或不确定的词，原样写入 uncertainSpans。"
    "截图中若有学生姓名、学校、班级等信息，一律忽略，不要写入任何字段。"
)

_SUBJECT_ENUM = SUBJECTS

RECOGNIZE_SCHEMA = {
    "type": "object",
    "properties": {
        "items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "subject": {"type": "string", "enum": _SUBJECT_ENUM},
                    "knowledgePoints": {"type": "array", "items": {"type": "string"}},
                    "stemText": {"type": "string"},
                    "questionType": {"type": "string", "enum": QUESTION_TYPES},
                    "options": {"type": "array", "items": {"type": "string"}},
                    "uncertainSpans": {"type": "array", "items": {"type": "string"}},
                    "studentAnswer": {"type": "string"},
                    "correctAnswer": {"type": "string"},
                    "analysis": {"type": "string"},
                    "tip": {"type": "string"},
                },
                "required": [
                    "subject",
                    "knowledgePoints",
                    "stemText",
                    "questionType",
                    "options",
                    "uncertainSpans",
                    "studentAnswer",
                    "correctAnswer",
                    "analysis",
                    "tip",
                ],
                "additionalProperties": False,
            },
        }
    },
    "required": ["items"],
    "additionalProperties": False,
}

SCAN_SYSTEM_PROMPT = (
    "你是一位小学教师助手。你会收到整页试卷的照片（可能有多页）。请找出页面上所有被判为错误的题目："
    "依据包括红叉、半对半错的勾叉、扣分标记、老师的红笔订正、学生作答与正确答案不符等。"
    "答对的题（打勾且作答正确）不要输出。对每道错题：提取题目原文（保留分数、公式与选项原样），"
    "识别学生写的作答，判断学科，标注 1 到 3 个知识点（课本常见说法），给出正确答案、"
    "面向小学生的简短解析（不超过 120 字）和一句「下次注意」提示，并说明判错依据。"
    "bbox 为该题在所在页面上的位置，格式 [x0, y0, x1, y1]，均为 0 到 1 的比例（相对页面宽高），"
    "要完整包住题干、选项和学生作答。看不清的词写入 uncertainSpans。"
    "页面上的学生姓名、学校、班级一律忽略。"
)

_SCAN_ITEM_PROPS = dict(RECOGNIZE_SCHEMA["properties"]["items"]["items"]["properties"])
_SCAN_ITEM_PROPS.update(
    {
        "page": {"type": "integer"},
        "bbox": {"type": "array", "items": {"type": "number"}, "minItems": 4, "maxItems": 4},
        "reason": {"type": "string"},
    }
)
SCAN_SCHEMA = {
    "type": "object",
    "properties": {
        "items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": _SCAN_ITEM_PROPS,
                "required": RECOGNIZE_SCHEMA["properties"]["items"]["items"]["required"] + ["page", "bbox", "reason"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["items"],
    "additionalProperties": False,
}

DIGITIZE_SYSTEM_PROMPT = (
    "你是一位教师助手，负责把试卷照片逐字逐段还原成电子版，并且保持与原卷一致的版面结构。你会收到一张试卷照片，"
    "有时还会附上 OCR 模型逐行识别出的印刷文字：题目、选项、大题说明、页眉页脚等印刷内容的汉字和英文单词以 OCR 文字为准逐字照抄，不要改写；"
    "但 OCR 经常漏掉或认错数学符号（负号、上标 ²³、下标、分数线、根号、括号），式子里出现的「区」「☒」「×」等怪字通常就是负号或上标被认错：公式和数字一律以照片为准重新写对，不要照抄 OCR 的错误，也不要因此写成「□」；"
    "照片用来判断版面结构（分栏、分块、空格位置）、学生手写作答和老师批改符号。OCR 文字里以「[手写]」开头的行是 OCR 猜测的学生手写内容，这个猜测可能出错（整行印刷题干也可能被标成手写），一律以照片为准：照片里是印刷的仍照抄为题干，是学生手写的就填进 student，不要因为带了 [手写] 标记就漏掉题目。"
    "OCR 文字里的 LaTeX 标记要这样处理：\\underline{...} 表示原卷划线，正文只保留划线里的文字，并在 instruction 里注明划线部分（如「对划线部分提问：With the help of these games」）；"
    "\\text{...}、\\( \\) 这类包装只是排版，去掉只留内容。\n"
    "公式的写法：数学、物理、化学的公式和表达式（分数、根号、上下标、方程、函数式、坐标运算等）一律写成 LaTeX 并用 $ 包起来，如 $y=-\\frac{3}{4}x^2+\\frac{3}{2}x+\\frac{9}{4}$、$A(-1,0)$、$\\sqrt{2}$、$\\mathrm{H_2O}$；普通文字、单独的数字和选项字母不要加 $。题干 text、学生作答 student、answer、analysis 都遵守。\n"
    "输出 sheets：照片里拍到几页卷面就输出几个 sheet（左右两页拍在一张照片里就是两个 sheet，先左后右）。"
    "每个 sheet 还要评估这页照片的拍摄质量：photoIssues 列出影响识别的问题（blurry 模糊失焦、cropped 卷面有题被拍到照片外或被裁掉、dark 太暗、glare 反光、tilted 严重倾斜变形、covered 被手指物品遮挡或折痕），拍得好就给空数组；photoNote 用一句话（不超过 30 字）说明哪里受影响，如「右下角反光，第 38–40 题看不清」「底部被裁掉，第 21 题以后不完整」，没有问题留空。只报告真正影响识别的问题，轻微的不报。"
    "照片边缘只拍到一部分的相邻页（文字被照片边缘截断、句子不完整）不要还原，不要为它单独建 sheet，也不要把它的题号记到别的空上；同一题号在整张照片里只能出现一次。"
    "每个 sheet 给出页码文字 label（如「第5页」）、卷头标题 title、卷面总分或得分 score（原样文字）、不属于任何块的零散文字 note，"
    "并根据卷头、页眉页脚、题型判断整张卷子的学科 subject（学科枚举，如「九年级化学」就是 chemistry；题块的 subject 默认和它一致，只有卷子里夹了别科内容才单独标）和考试信息：examLevel（单元测 / 期中 / 期末 / 中考模拟 / 中考 / 高考模拟 / 高考 / 竞赛 / 日常练习）、examGrade（年级或学段，如「九年级」）、"
    "region（地区，如「上海」；嘉定区、浦东新区等区名要写成所属城市）、syllabus（知识点归类依据的考纲或课标名称，如「上海中考英语考纲」「人教版五年级数学课标」）；判断不了的用学生资料里的年级，region 留空。\n"
    "以及 blocks：按原卷阅读顺序（先左栏后右栏、自上而下）排列的版面块，块的类型有：\n"
    "- section：大题标题。label 是大题编号（如「Ⅳ」「三」），title 是标题原文（英文题保留英文），instruction 是作答说明（如「用括号中所给单词的适当形式完成下列句子。每空格限填一词」），points 是分值（如「共8分」）。大题说明只放在 section 里，绝不要并进小题。\n"
    "- passage：短文、阅读材料、对话等整段文字。篇号（如「(A)」「(B)」）放 label，不要单独成块；原文逐字转写进 text；文中每个作答空格用 [[空号]] 占位（如 ...more fun than [[38]] classes），并在 blanks 里逐空记录。短文从第一个字开始完整转写，不要从中间开始，不要省略。短文下方供作答的横线行（如「40.____ 41.____」）不要写进 text，那里的手写字母记入对应空的 student；短文里的空一律记在该 passage 的 blanks 里，不要另拆成 item。\n"
    "- wordbank：选词填空的词库方框或一组共用选项，options 原样逐项（如「A. repairs」）。\n"
    "- item：一道小题。number 是题号原样，text 是题目原文（空格用 [[空号]] 占位；一题多空用 [[52-1]] [[52-2]]），hint 是句末括号里的给词（如「(bakery)」），instruction 是括号里的改写要求（如「改为一般疑问句」），选择题的选项放 options，blanks 逐空记录。\n"
    "- text：页眉页脚、订正提醒等其他文字。\n"
    "- figure：插图、人物或场景插画、漫画 / 连环画、看图写话的图、统计图、函数图像、几何图形、实验装置图、表格等光靠文字还原不了的内容，原卷有几幅就输出几个 figure 块，放在它在原卷出现的位置。"
    "图片当选项的选择题（如「选出与图片相符的一项」下面 A、B、C 各是一张小图）：每个选项图各输出一个 figure，number 写本题题号，label 写选项字母（「A」）；这道 item 的 options 写成「A. （图）一个女孩在游泳」这样的字母加一句描述。"
    "图文配对题（图片上印着 A–F 等标号，下面的句子或短文选图作答）：每张标号图各输出一个 figure，label 写图上的标号（「A」「①」），number 留空（几道题共用），学生作答写选的标号。"
    "其他插图 label 留空；一组连环画、一排烧杯这种本来就是一幅的图不要拆开，也不要给 label。"
    "title 写图题（如「图1」「图2」；表格没有标题写「表格」，其他没有图题的写「插图」）；number 写这幅图所属小题的题号（如「5」；几道题共用或说不清时留空）；"
    "text 用一两句话说清图里有什么、能读出的关键数据（如「硝酸钾、氯化钾溶解度曲线：t₁℃ 时氯化钾 34g」；表格逐行简述），供图片显示不了时参考；"
    "bbox 紧紧包住整幅图（含图中标注和图题）。OCR 文字末尾列出了版面分析检测到的插图 / 表格区域时，bbox 直接照抄与这幅图对应的区域坐标。\n"
    "图中的文字（坐标轴、刻度、图例、标注、表格里的内容、装置说明，以及 OCR 里以 [图中文字] 开头的行）只写进 figure 的 text，"
    "绝不要写进题干 text、选项、passage 或 note；题干里保留「如图所示」「如下表」这样的原文即可。\n"
    "text 里不要保留照片或 OCR 文字里的排版换行：一句话被印成两行的要合成一行；只有原卷真正分段、分行（新段落、诗歌、逐行列表）才用换行。\n"
    "每个空（blank）：id 与占位一致；number 是所属题号；student 只写学生手写内容的逐字转写（涂改后以最终答案为准；解题过程按原来的步骤分行，每步一行；看不清的字用「□」，没写就留空，不要写「无法辨认」之类的描述）；"
    "mark 按老师的批改符号判定：打勾「✓」「√」「☑」或写了对号 = correct；打叉「✗」「×」、斜杠「/」、划掉、圈出 = wrong；半勾、打分低于满分、部分扣分 = partial；完全没有批改符号 = unmarked。"
    "没有写作答的空 mark = blank（未作答，单独一类，不是答错；student 留空，绝不要把正确答案填进 student）。note 只记录老师的红笔批注或扣分，不写任何说明或推测；"
    "answer 只写正确答案本身（mark 为 wrong、partial、blank 或 unmarked 时都必须给出，correct 时留空；词库、原文在别的页上时，按上下文和常识给出最可能的答案，绝不留空，不要写任何说明文字）。老师没批改（unmarked）的空，由你当阅卷老师：给出 answer，并在 analysis 里写清对错依据（判对时 analysis 可留空）；analysis 是判错时面向学生的简短解析（不超过 80 字，correct 时留空）。解答题（questionType 为 solve）特殊处理：answer 只写最终结果；analysis 写 2 到 4 步标准解法，每步一行，判错时最后一行用「错在：」指出学生哪一步出错。学生作答和正确答案数学上等价（因式分解式与展开式、分数与小数、化简前后、换了一种正确解法）算对。\n"
    "passage 与 item 块还要给出：subject（学科枚举）、questionType（choice/fill/solve）、知识点 knowledgePoints（所有题都给，1 到 3 项）、判错或未作答时一句「下次注意」tip、看不清的词 uncertainSpans，"
    "以及 bbox。知识点的要求：第一项必须是 syllabus 对应考纲 / 课标里的一级知识点名称，整张卷子用统一的规范名称，便于按知识点归类记忆；后面的项才是细分点。"
    "例如英语按考纲语法与题型：名词、代词、冠词、数词、介词、连词、形容词和副词、动词时态、被动语态、非谓语动词、情态动词、构词法、简单句句型、并列句、宾语从句、定语从句、状语从句、词汇辨析、完形填空、阅读理解、选词填空、句型转换、书面表达；"
    "数学按课标领域到章节：如「数与代数 · 一元二次方程」「图形与几何 · 相似三角形」「统计与概率 · 概率初步」；语文：字词、句子、修辞、标点、阅读理解、古诗文、写作；科学按单元主题；"
    "物理：力学、运动和力、压强与浮力、功和机械能、热学、光学、声学、电学（电路 / 欧姆定律 / 电功率）、电与磁、能源；"
    "化学：物质的构成（分子原子离子 / 元素 / 化学式）、化学方程式与计算、空气与氧气、水与溶液、碳和碳的化合物、金属、酸碱盐、化学实验基本操作、化学与生活；"
    "生物：细胞、生物与环境、植物的生活、人体的结构与功能、动物、遗传与进化、健康生活；历史：中国古代史、中国近代史、中国现代史、世界史；地理：地球与地图、中国地理、世界地理、人文地理；道法：道德与心理、法律、国情与政治。"
    "同一道题的多个空共用块级知识点。"
    "bbox 是该块在整张照片上的位置 [x0, y0, x1, y1]（0 到 1 的比例），完整包住该块的文字与作答。其他类型的块 bbox 也要给，没有知识点等字段时给空值。\n"
    "要求：不要遗漏任何题目和空格，答对的题也要转写；手写内容一定要按空号一一对应，不要合并；学生姓名、学校、班级一律忽略，不要写入任何字段。"
)

_BLANK_PROPS = {
    "id": {"type": "string"},
    "number": {"type": "string"},
    "student": {"type": "string"},
    "mark": {"type": "string", "enum": ["correct", "wrong", "partial", "blank", "unmarked"]},
    "note": {"type": "string"},
    "answer": {"type": "string"},
    "analysis": {"type": "string"},
}
_BLOCK_PROPS = {
    "type": {"type": "string", "enum": BLOCK_TYPES},
    "text": {"type": "string"},
    "label": {"type": "string"},
    "title": {"type": "string"},
    "instruction": {"type": "string"},
    "points": {"type": "string"},
    "number": {"type": "string"},
    "hint": {"type": "string"},
    "options": {"type": "array", "items": {"type": "string"}},
    "blanks": {"type": "array", "items": {"type": "object", "properties": _BLANK_PROPS, "required": list(_BLANK_PROPS), "additionalProperties": False}},
    "bbox": {"type": "array", "items": {"type": "number"}, "minItems": 4, "maxItems": 4},
    "subject": {"type": "string", "enum": _SUBJECT_ENUM},
    "questionType": {"type": "string", "enum": QUESTION_TYPES},
    "knowledgePoints": {"type": "array", "items": {"type": "string"}},
    "tip": {"type": "string"},
    "uncertainSpans": {"type": "array", "items": {"type": "string"}},
}
_SHEET_PROPS = {
    "label": {"type": "string"},
    "title": {"type": "string"},
    "score": {"type": "string"},
    "note": {"type": "string"},
    "subject": {"type": "string", "enum": _SUBJECT_ENUM},
    "examLevel": {"type": "string"},
    "examGrade": {"type": "string"},
    "region": {"type": "string"},
    "syllabus": {"type": "string"},
    "photoIssues": {"type": "array", "items": {"type": "string", "enum": ["blurry", "cropped", "dark", "glare", "tilted", "covered"]}},
    "photoNote": {"type": "string"},
    "blocks": {"type": "array", "items": {"type": "object", "properties": _BLOCK_PROPS, "required": list(_BLOCK_PROPS), "additionalProperties": False}},
}
GRADE_SYSTEM_PROMPT = (
    "你是认真负责的阅卷老师。下面是一份试卷里老师没有批改的空，每个空给了题目上下文（【空】标出要判的位置）、可选项或词库、学生作答。"
    "整张卷子的 OCR 文字也附在后面，词库、短文前后文可能在别的页上，请结合起来判断。"
    "对每个空：answer 写正确答案本身（选择题写选项字母，填空写词或短语，不要写说明）；"
    "verdict 是你对学生作答的判定：correct（对）、wrong（错）、partial（部分对，只用于多空或解答题）；学生答案和正确答案数学上等价（因式分解式与展开式、分数与小数、化简前后、不同但正确的解法）一律算对；"
    "analysis 判错或部分对时写一句面向学生的解析（不超过 60 字），判对时留空；解答题改为 2 到 4 步标准解法，每步一行，最后一行用「错在：」指出学生哪一步出错。公式用 LaTeX 写在 $ 里（如 $\\frac{3}{4}$）。拿不准时也必须给出最可能的结论。"
)

GRADE_SCHEMA = {
    "type": "object",
    "properties": {
        "results": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "key": {"type": "string"},
                    "answer": {"type": "string"},
                    "verdict": {"type": "string", "enum": ["correct", "wrong", "partial"]},
                    "analysis": {"type": "string"},
                },
                "required": ["key", "answer", "verdict", "analysis"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["results"],
    "additionalProperties": False,
}

DIGITIZE_SCHEMA = {
    "type": "object",
    "properties": {
        "sheets": {"type": "array", "items": {"type": "object", "properties": _SHEET_PROPS, "required": list(_SHEET_PROPS), "additionalProperties": False}},
    },
    "required": ["sheets"],
    "additionalProperties": False,
}

VARIANT_SCHEMA = {
    "type": "object",
    "properties": {
        "variants": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "question": {"type": "string"},
                    "questionType": {"type": "string", "enum": QUESTION_TYPES},
                    "options": {"type": "array", "items": {"type": "string"}},
                    "answer": {"type": "string"},
                    "analysis": {"type": "string"},
                },
                "required": ["question", "questionType", "options", "answer", "analysis"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["variants"],
    "additionalProperties": False,
}


def extract_json(text: str) -> dict:
    """从模型输出里取出 JSON 对象：兼容 ```json 围栏、前后多余说明文字。"""
    text = (text or "").strip()
    fence = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.S)
    if fence:
        text = fence.group(1)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    start, end = text.find("{"), text.rfind("}")
    if start != -1 and end > start:
        return json.loads(text[start : end + 1])
    raise json.JSONDecodeError("no JSON object found", text, 0)


def grade_label(grade: str) -> str:
    """1–9 年级直接说几年级，10–12 换成高一到高三。"""
    try:
        g = int(grade)
    except (TypeError, ValueError):
        return f"{grade}年级"
    if g >= 10:
        return ["高一", "高二", "高三"][min(g, 12) - 10]
    return f"{'一二三四五六七八九'[g - 1] if 1 <= g <= 9 else g}年级"


def is_relay_base_url(url: str | None) -> bool:
    return bool(url) and "anthropic.com" not in url


class ClaudeProvider(AIProvider):
    def __init__(self, model: str = "claude-opus-5-5", relay: bool | None = None):
        # 凭据与地址从环境解析：ANTHROPIC_API_KEY、ANTHROPIC_BASE_URL（中转）或 `ant auth login` 的配置
        self.client = anthropic.Anthropic()
        self.model = model
        env_relay = os.getenv("ANTHROPIC_RELAY_MODE")
        if relay is not None:
            self.relay = relay
        elif env_relay in ("0", "1"):
            self.relay = env_relay == "1"
        else:
            self.relay = is_relay_base_url(os.getenv("ANTHROPIC_BASE_URL"))
        self.name = "claude-relay" if self.relay else "claude"

    # ------------------------------------------------------------------ helpers
    def _create(self, system: str, content: list[dict], schema: dict, max_tokens: int, on_text=None):
        """统一用流式请求再取完整消息：SDK 对大 max_tokens 的非流式调用会直接拒绝，流式也不受 HTTP 超时影响。
        on_text(chars) 在流式输出过程中按累计字数回调，用来推进进度。"""

        def drain(stream):
            if on_text is None:
                return stream.get_final_message()
            n = 0
            for piece in stream.text_stream:
                n += len(piece)
                on_text(n)
            return stream.get_final_message()

        if self.relay:
            instruction = (
                "\n\n只输出一个 JSON 对象，不要任何解释、前后缀或 Markdown 围栏。"
                "JSON 必须符合下面的 JSON Schema：\n" + json.dumps(schema, ensure_ascii=False)
            )
            content = list(content) + [{"type": "text", "text": instruction}]
            with self.client.messages.stream(
                model=self.model,
                max_tokens=max_tokens,
                system=system,
                messages=[{"role": "user", "content": content}],
            ) as stream:
                return drain(stream)
        with self.client.beta.messages.stream(
            model=self.model,
            max_tokens=max_tokens,
            system=system,
            messages=[{"role": "user", "content": content}],
            output_config={"format": {"type": "json_schema", "schema": schema}},
            # 安全分类器拒答时由服务端自动改用备用模型
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
        ) as stream:
            return drain(stream)

    def _call(self, system: str, content: list[dict], schema: dict, max_tokens: int = 16000, on_text=None) -> dict:
        try:
            response = self._create(system, content, schema, max_tokens, on_text=on_text)
        except anthropic.AuthenticationError as e:
            raise AIError("AI 服务的密钥无效，请检查 ANTHROPIC_API_KEY") from e
        except anthropic.PermissionDeniedError as e:
            log.warning("anthropic 403: %s", e.message)
            raise AIError("AI 服务额度不足或无权限，请联系管理员充值") from e
        except anthropic.RateLimitError as e:
            raise AIError("AI 服务正忙，请稍后再试") from e
        except anthropic.APIStatusError as e:
            log.warning("anthropic status error %s: %s", e.status_code, e.message)
            raise AIError("AI 服务暂时不可用，题目已保留，稍后可重试") from e
        except anthropic.APIConnectionError as e:
            raise AIError("连不上 AI 服务，请检查网络") from e

        if response.stop_reason == "refusal":
            detail = getattr(response, "stop_details", None)
            log.warning("claude refusal: %s", getattr(detail, "category", None))
            raise AIError("这张截图 AI 无法处理，请手动填写题目")
        if response.stop_reason == "max_tokens":
            raise AIError("AI 返回内容过长被截断，请减少一次识别的题目数量")

        text = "".join(b.text for b in response.content if getattr(b, "type", "") == "text")
        try:
            return extract_json(text)
        except json.JSONDecodeError as e:
            log.warning("unparseable model output: %.300s", text)
            raise AIError("AI 返回了无法解析的结果，请重试") from e

    # ------------------------------------------------------------------ api
    def recognize(self, crops: list[Crop], subjects: list[str], grade: str) -> list[RecognizedItem]:
        content: list[dict] = []
        for i, crop in enumerate(crops):
            content.append({"type": "text", "text": f"第 {i + 1} 张截图："})
            content.append(
                {
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": crop.media_type,
                        "data": base64.standard_b64encode(crop.data).decode("utf-8"),
                    },
                }
            )
            if crop.hint:
                content.append({"type": "text", "text": f"用户补充的题干文字：{crop.hint}"})
        subject_names = "、".join(SUBJECT_LABELS[s] for s in subjects if s in SUBJECT_LABELS)
        content.append(
            {
                "type": "text",
                "text": (
                    f"学生年级：小学{grade}年级。可选学科：{subject_names}（subject 字段用英文枚举）。"
                    f"共 {len(crops)} 张截图，请按截图顺序在 items 中返回 {len(crops)} 项，每张截图一项。"
                ),
            }
        )
        data = self._call(SYSTEM_PROMPT, content, RECOGNIZE_SCHEMA)
        items = [RecognizedItem(**_clean_item(it)) for it in data.get("items", [])]
        # 兜底：条数不符时按截图数对齐
        while len(items) < len(crops):
            items.append(RecognizedItem(subject=subjects[0] if subjects else "math", knowledgePoints=[], stemText=""))
        return items[: len(crops)]

    def scan_pages(self, pages: list[Crop], subjects: list[str], grade: str) -> list[ScannedItem]:
        content: list[dict] = []
        for i, page in enumerate(pages):
            content.append({"type": "text", "text": f"第 {i} 页（page = {i}）："})
            content.append(
                {
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": page.media_type,
                        "data": base64.standard_b64encode(page.data).decode("utf-8"),
                    },
                }
            )
        subject_names = "、".join(SUBJECT_LABELS[s] for s in subjects if s in SUBJECT_LABELS)
        content.append(
            {
                "type": "text",
                "text": (
                    f"学生年级：小学{grade}年级。可选学科：{subject_names}（subject 字段用英文枚举）。"
                    f"共 {len(pages)} 页，请把所有页面上的错题都列出来，page 从 0 开始计数；没有错题则 items 为空数组。"
                ),
            }
        )
        data = self._call(SCAN_SYSTEM_PROMPT, content, SCAN_SCHEMA, max_tokens=24000)
        items: list[ScannedItem] = []
        for raw in data.get("items", []):
            cleaned = _clean_item(raw)
            page = int(raw.get("page", 0) or 0)
            bbox = raw.get("bbox") if isinstance(raw.get("bbox"), list) and len(raw.get("bbox")) == 4 else [0, 0, 1, 1]
            try:
                bbox = [min(1.0, max(0.0, float(v))) for v in bbox]
            except (TypeError, ValueError):
                bbox = [0.0, 0.0, 1.0, 1.0]
            if bbox[2] <= bbox[0] or bbox[3] <= bbox[1]:
                bbox = [0.0, 0.0, 1.0, 1.0]
            items.append(ScannedItem(**cleaned, page=min(max(page, 0), len(pages) - 1), bbox=bbox, reason=str(raw.get("reason") or "")))
        return items

    def digitize_pages(self, pages: list[Crop], subjects: list[str], grade: str, region: str = "", on_page_done=None, on_page_start=None, on_page_progress=None):
        """每张照片单独调用一次模型，经全局队列并发还原（整个进程最多 MAX_CONCURRENT_PAGES 张同时调模型），再合并派生题目。"""
        subject_names = "、".join(SUBJECT_LABELS[s] for s in subjects if s in SUBJECT_LABELS)

        def one(index: int, page: Crop) -> list[DigitizedPage]:
            # 第一步：OCR（paddle / baidu，见 ai/ocr.py）把文字逐行识别出来（几秒钟）；失败就退回让大模型直接看图
            ocr_text = ""
            ocr_result = None
            if ocr.enabled():
                try:
                    ocr_result = ocr.ocr_page(page.data, page.media_type)
                    ocr_text = ocr_result.text
                except ocr.OCRError as e:
                    log.warning("ocr failed on page %s, fallback to image only: %s", index, e)
                if on_page_progress:
                    on_page_progress(index, 0.08)
            content = [
                {
                    "type": "image",
                    "source": {"type": "base64", "media_type": page.media_type, "data": base64.standard_b64encode(page.data).decode("utf-8")},
                },
            ]
            if ocr_text:
                content.append({"type": "text", "text": "OCR 模型逐行识别出的文字（已按分栏排序，栏间空行；公式为 LaTeX；印刷内容以此为准逐字照抄；以 [手写] 开头的行是 OCR 猜测的学生手写，可能有误，以照片为准；以 [图中文字] 开头的行在插图或表格里，只能写进 figure 块）：\n<ocr>\n" + ocr_text[:20000] + "\n</ocr>"})
            content += [
                {
                    "type": "text",
                    "text": (
                        f"学生年级：{grade_label(grade)}。" + (f"学生所在城市：{region}（卷面看不出地区时按此地考纲归类）。" if region else "")
                        + f"可选学科：{subject_names}（subject 字段用英文枚举）。"
                        "请按原卷版面把这张照片完整还原为 sheets，保持阅读顺序与格式。"
                    ),
                },
            ]
            # 整页输出通常 8k–20k 字：按已生成字数估算这一页的完成度，曲线渐近到 1（OCR 阶段占前 8%）
            on_text = (lambda n: on_page_progress(index, 0.08 + 0.92 * (1 - math.exp(-n / 9000.0)))) if on_page_progress else None
            # 模型偶尔吐出解析不了 / 被截断的 JSON：这张照片自动重试一次，不让整个任务失败
            try:
                data = self._call(DIGITIZE_SYSTEM_PROMPT, content, DIGITIZE_SCHEMA, max_tokens=32000, on_text=on_text)
            except AIError as e:
                if "无法解析" not in str(e) and "过长" not in str(e):
                    raise
                log.warning("digitize page %s retry after: %s", index, e)
                data = self._call(DIGITIZE_SYSTEM_PROMPT, content, DIGITIZE_SCHEMA, max_tokens=32000, on_text=on_text)
            sheets = clean_sheets(data, index)
            if ocr_result is not None:
                snap_figures(sheets, ocr_result.regions, ocr_result.direction)
            for sh in sheets:
                sh.ocrText = ocr_text
            if on_page_done:
                with progress_lock:
                    done_count[0] += 1
                    on_page_done(done_count[0], len(pages))
            return sheets

        progress_lock = __import__("threading").Lock()
        done_count = [0]
        started_count = [0]

        def started() -> None:
            if on_page_start:
                with progress_lock:
                    started_count[0] += 1
                    on_page_start(started_count[0], len(pages))

        futures = [page_queue.submit(lambda i=i, p=p: one(i, p), on_start=started) for i, p in enumerate(pages)]
        results = [f.result() for f in futures]
        sheets = drop_ghost_sheets([sheet for group in results for sheet in group])
        # 第二步：老师没批改、按答案也对不上的空，交给大模型统一阅卷（能看到全卷 OCR，词库在别页也能判）
        try:
            self.grade_unmarked(sheets)
        except Exception as e:  # noqa: BLE001  阅卷失败不影响还原结果
            log.warning("grade_unmarked failed: %s", e)
        return sheets, derive_questions(sheets)

    def grade_unmarked(self, sheets: list[DigitizedPage], batch: int = 40, rounds: int = 2) -> int:
        """把仍是 unmarked（老师没批改、自动对答案也判不了）且学生写了作答的空交给大模型判对错；
        第一轮漏判或调用失败的再送一轮。返回判了多少个。"""
        total = 0
        for r in range(rounds):
            try:
                n = self._grade_round(sheets, batch)
            except Exception as e:  # noqa: BLE001
                log.warning("grade round %d failed: %s", r + 1, e)
                continue
            total += n
            if n == 0 or not self._ungraded(sheets):
                break
        return total

    @staticmethod
    def _ungraded(sheets: list[DigitizedPage]) -> int:
        return sum(1 for s in sheets for blk in s.blocks if blk.type in ("item", "passage") for b in blk.blanks if b.mark == "unmarked" and b.student.strip() and not unreadable(b.student))

    def _grade_round(self, sheets: list[DigitizedPage], batch: int) -> int:
        todo: list[tuple[str, DigitizedBlank, str]] = []
        for si, sheet in enumerate(sheets):
            section = ""
            for bi, block in enumerate(sheet.blocks):
                if block.type == "section":
                    section = " ".join(x for x in [block.label, block.title, block.instruction] if x)
                    continue
                if block.type not in ("item", "passage"):
                    continue
                options = block.options or (_nearby_wordbank(sheet.blocks, bi) if block.type == "passage" else [])
                for b in block.blanks:
                    # 没写的不送；整个看不清的也不送（猜不出来，界面显示「看不清」并提示重拍）
                    if b.mark != "unmarked" or not b.student.strip() or unreadable(b.student):
                        continue
                    stem = _render_text(block.text, block.blanks, b.id).replace("____", "【空】", 1)
                    extra = " ".join(x for x in [block.hint, f"（{block.instruction}）" if block.instruction else ""] if x)
                    ctx = "\n".join(x for x in [
                        f"大题：{section}" if section else "",
                        f"题号：{b.number or b.id}（{block.questionType}）",
                        f"题目：{stem[:1500]} {extra}".strip(),
                        f"选项 / 词库：{'　'.join(options)}" if options else "",
                        f"学生作答：{b.student}",
                        f"识别时给出的参考答案：{b.answer}" if b.answer else "",
                    ] if x)
                    todo.append((f"s{si}b{bi}#{b.id}", b, ctx))
        if not todo:
            return 0
        ocr = "\n\n".join(dict.fromkeys(s.ocrText for s in sheets if s.ocrText))[:12000]
        graded = 0
        for i in range(0, len(todo), batch):
            chunk = todo[i : i + batch]
            text = "\n\n".join(f"<blank key=\"{k}\">\n{ctx}\n</blank>" for k, _, ctx in chunk)
            if ocr:
                text += "\n\n整张卷子的 OCR 文字（供查找词库和上下文）：\n<ocr>\n" + ocr + "\n</ocr>"
            data = self._call(GRADE_SYSTEM_PROMPT, [{"type": "text", "text": text}], GRADE_SCHEMA, max_tokens=8000)
            by_key = {str(r.get("key")): r for r in data.get("results", []) if isinstance(r, dict)}
            for key, b, _ in chunk:
                r = by_key.get(key)
                if not r or r.get("verdict") not in ("correct", "wrong", "partial"):
                    continue
                b.mark = r["verdict"]
                b.aiGraded = True
                ans = str(r.get("answer") or "").strip()
                if ans and not b.answer:
                    b.answer = ans[:200]
                if b.mark != "correct" and not b.analysis:
                    b.analysis = str(r.get("analysis") or "").strip()[:200]
                graded += 1
        log.info("ai graded %d/%d unmarked blank(s)", graded, len(todo))
        return graded

    def generate_variants(self, mistake: dict, count: int = 2) -> list[Variant]:
        subject = SUBJECT_LABELS.get(mistake.get("subject", ""), mistake.get("subject", ""))
        prompt = (
            f"学科：{subject}；知识点：{'、'.join(mistake.get('knowledgePoints', []))}。\n"
            f"原题：{mistake.get('stemText', '')}\n"
            f"学生当时的错误：{mistake.get('studentAnswer', '')}（错因：{'、'.join(mistake.get('reasons', []))}）\n"
            f"请出 {count} 道考查同一知识点、难度相当、数字或情境不同的同类变式题。"
            "优先出单选题（3 个选项，answer 写选项字母 A/B/C）或填空题（answer 写答案本身），"
            "每题附不超过 80 字的解析。"
        )
        data = self._call(
            "你是一位小学教师，擅长为学生出同类变式题，题目表述简洁、面向小学生。",
            [{"type": "text", "text": prompt}],
            VARIANT_SCHEMA,
            max_tokens=4000,
        )
        return [Variant(**_clean_variant(v)) for v in data.get("variants", [])][:count]


_ITEM_KEYS = {f for f in RecognizedItem.__dataclass_fields__}  # noqa: SLF001
_VARIANT_KEYS = {f for f in Variant.__dataclass_fields__}  # noqa: SLF001


def _clean_item(raw: dict) -> dict:
    """中转模式下模型可能多给或少给字段：只保留已知字段并补默认值。"""
    out = {k: raw[k] for k in _ITEM_KEYS if k in raw}
    out.setdefault("subject", "math")
    if out["subject"] not in SUBJECTS:
        out["subject"] = "math"
    out.setdefault("knowledgePoints", [])
    out.setdefault("stemText", "")
    if out.get("questionType") not in QUESTION_TYPES:
        out["questionType"] = "solve"
    for key in ("options", "uncertainSpans"):
        if not isinstance(out.get(key), list):
            out[key] = []
    for key in ("studentAnswer", "correctAnswer", "analysis", "tip"):
        out[key] = str(out.get(key) or "")
    return out


def _clean_variant(raw: dict) -> dict:
    out = {k: raw[k] for k in _VARIANT_KEYS if k in raw}
    out.setdefault("question", "")
    if out.get("questionType") not in QUESTION_TYPES:
        out["questionType"] = "solve"
    if not isinstance(out.get("options"), list):
        out["options"] = []
    out["answer"] = str(out.get("answer") or "")
    out["analysis"] = str(out.get("analysis") or "")
    return out
