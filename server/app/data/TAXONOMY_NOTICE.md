# 知识图谱数据来源

`taxonomy.json` 由 `scripts/build_taxonomy.py` 从 [cn-math-taxonomy](https://github.com/xiaoyang111222/cn-math-taxonomy) 精简而来，
只保留知识点的 id、名称、学科、领域、年级、学期、章节和 hard 先修边。源仓库的提交号写在文件的 `meta.commit` 里。

原数据按 [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/) 许可发布（署名、非商业使用）。
源数据是 AI 生成的初稿，未经教师审核；知错本只把它当作标注用的受控词表，先修关系只作「建议先复习」的提示。

`taxonomy_aliases.json` 是知错本自己维护的别名表：上海（沪教版）教材里的说法 → 图谱知识点 id，
给标注校验和离线评测用。按匹配失败的日志逐步补。
