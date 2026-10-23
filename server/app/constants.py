# 小学到高中全部学科；science 是小学科学，初高中用 physics / chemistry / biology
SUBJECTS = ["math", "chinese", "english", "science", "physics", "chemistry", "biology", "history", "geography", "politics"]
SUBJECT_LABELS = {
    "math": "数学", "chinese": "语文", "english": "英语", "science": "科学",
    "physics": "物理", "chemistry": "化学", "biology": "生物", "history": "历史", "geography": "地理", "politics": "道法",
}

REASONS = ["concept", "misread", "method", "calculation", "careless"]
REASON_LABELS = {
    "concept": "概念不清",
    "misread": "审题错误",
    "method": "方法不当",
    "calculation": "计算失误",
    "careless": "粗心",
}

QUESTION_TYPES = ["choice", "fill", "solve"]

RATINGS = ["forgot", "fuzzy", "remembered"]

GRADES = [str(i) for i in range(1, 13)]  # 1–9 小学初中，10–12 高一到高三
