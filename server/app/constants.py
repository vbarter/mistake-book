SUBJECTS = ["math", "chinese", "english", "science"]
SUBJECT_LABELS = {"math": "数学", "chinese": "语文", "english": "英语", "science": "科学"}

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
