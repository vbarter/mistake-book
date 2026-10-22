import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { DigitizedQuestion, Mark, RecognizedItem } from "../../api/types";
import { Icon } from "../../components/Icon";
import { Button, InlineNav, Sheet, SubjectChip } from "../../components/ui";
import { cropToDataUrl } from "../../lib/boxes";
import { QTYPE_LABEL } from "../../lib/format";
import { haptic } from "../../lib/native";
import { toast, toastError } from "../../store/banner";
import { useCapture } from "../../store/capture";

const MARK: Record<Mark, { label: string; color: string; bg: string; icon: "check" | "xmark" | "warning" | "info" }> = {
  correct: { label: "正确", color: "var(--mastered)", bg: "var(--mastered-bg)", icon: "check" },
  wrong: { label: "错误", color: "var(--wrong)", bg: "var(--wrong-bg)", icon: "xmark" },
  partial: { label: "半对", color: "var(--due)", bg: "var(--due-bg)", icon: "warning" },
  unmarked: { label: "未批改", color: "var(--secondary)", bg: "var(--fill-light)", icon: "info" },
};

/** 电子版试卷：AI 还原的全部题目、手写作答转写与老师批改；判错题默认勾选，可一键导入核对。 */
export default function Paper() {
  const nav = useNavigate();
  const { pages, digitized, folderName, setItems } = useCapture();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [showOriginal, setShowOriginal] = useState<number | null>(null);
  const [preview, setPreview] = useState<DigitizedQuestion | null>(null);
  const [previewSrc, setPreviewSrc] = useState<string>("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!digitized || pages.length === 0) nav("/capture", { replace: true });
  }, [digitized, pages.length, nav]);

  useEffect(() => {
    if (digitized) setSelected(new Set(digitized.questions.filter((q) => q.mark === "wrong" || q.mark === "partial").map((q) => q.index)));
  }, [digitized]);

  const byPage = useMemo(() => {
    const map = new Map<number, DigitizedQuestion[]>();
    for (const q of digitized?.questions ?? []) {
      if (!map.has(q.page)) map.set(q.page, []);
      map.get(q.page)!.push(q);
    }
    return map;
  }, [digitized]);

  if (!digitized) return null;
  const wrongCount = digitized.questions.filter((q) => q.mark === "wrong" || q.mark === "partial").length;

  const toggle = (idx: number) => {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(idx)) n.delete(idx);
      else n.add(idx);
      return n;
    });
    void haptic.selection();
  };

  const openPreview = async (q: DigitizedQuestion) => {
    const page = pages[q.page];
    if (!page) return;
    const [x0, y0, x1, y1] = q.bbox;
    const src = await cropToDataUrl(page.src, { id: "p", x: x0 * page.width, y: y0 * page.height, w: Math.max(40, (x1 - x0) * page.width), h: Math.max(30, (y1 - y0) * page.height) }, 1200, 0.85);
    setPreviewSrc(src);
    setPreview(q);
  };

  const importSelected = async () => {
    const chosen = digitized.questions.filter((q) => selected.has(q.index));
    if (chosen.length === 0) return toast("先勾选要收进错题本的题");
    setBusy(true);
    try {
      const items: RecognizedItem[] = [];
      for (const q of chosen) {
        const page = pages[q.page];
        const [x0, y0, x1, y1] = q.bbox;
        const stemImage = page
          ? await cropToDataUrl(page.src, { id: "c", x: x0 * page.width, y: y0 * page.height, w: Math.max(40, (x1 - x0) * page.width), h: Math.max(30, (y1 - y0) * page.height) }, 1000, 0.8)
          : "";
        items.push({
          subject: q.subject,
          knowledgePoints: q.knowledgePoints,
          stemText: q.stemText,
          questionType: q.questionType,
          options: q.options,
          uncertainSpans: q.uncertainSpans,
          studentAnswer: q.studentAnswer,
          correctAnswer: q.correctAnswer,
          analysis: q.analysis,
          tip: q.tip,
          aiGenerated: true,
          stemImage,
          reasons: [],
          note: "",
          page: q.page,
          bbox: q.bbox,
          reason: q.mark === "correct" ? "答对的题，主动收录" : q.teacherNote ? `老师批改：${q.teacherNote}` : MARK[q.mark].label,
        });
      }
      setItems(items);
      void haptic.success();
      nav("/capture/review");
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="screen">
      <InlineNav title="电子版试卷" subtitle={`${folderName || "试卷"} · ${digitized.questions.length} 题`} back backLabel="试卷" right={<button className="nav-btn" onClick={() => nav("/capture")}>重新扫描</button>} />
      <div className="screen__content screen__content--modal" style={{ gap: 12, paddingTop: 4, paddingBottom: 0 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <span className="chip" style={{ background: "var(--wrong-bg)", color: "var(--wrong)" }}>判错 {wrongCount} 题</span>
          <span className="chip" style={{ background: "var(--mastered-bg)", color: "var(--mastered)" }}>正确 {digitized.questions.filter((q) => q.mark === "correct").length} 题</span>
          <span className="t-foot c-sec">勾选的题会收进错题本</span>
        </div>

        {pages.map((page, p) => {
          const info = digitized.pages.find((x) => x.page === p);
          const qs = byPage.get(p) ?? [];
          return (
            <div key={page.id} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div className="card" style={{ gap: 6 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                  <h2 className="t-title3">{info?.title || `第 ${p + 1} 页`}</h2>
                  {info?.score && <span className="t-headline" style={{ color: "var(--wrong)" }}>得分 {info.score}</span>}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span className="t-foot c-sec">{pages.length > 1 ? `第 ${p + 1} 页 · ` : ""}{qs.length} 题</span>
                  <button className="t-foot" style={{ color: "var(--brand)", fontWeight: 500, minHeight: 32 }} onClick={() => setShowOriginal(showOriginal === p ? null : p)}>
                    {showOriginal === p ? "收起原图" : "查看原图"}
                  </button>
                </div>
                {showOriginal === p && <img src={page.src} alt={`第 ${p + 1} 页原图`} style={{ width: "100%", borderRadius: 10, border: "1px solid var(--separator-light)" }} />}
                {info?.note && <p className="t-foot c-sec" style={{ background: "var(--fill-light)", borderRadius: 8, padding: "6px 10px" }}>{info.note}</p>}
              </div>

              {qs.map((q) => {
                const m = MARK[q.mark];
                const on = selected.has(q.index);
                return (
                  <div key={q.index} className="card" style={{ gap: 8, border: on ? "1.5px solid var(--brand)" : "1.5px solid transparent" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <button
                        role="checkbox"
                        aria-checked={on}
                        aria-label={`收录第 ${q.number} 题`}
                        onClick={() => toggle(q.index)}
                        style={{ width: 26, height: 26, borderRadius: 13, border: on ? "0" : "2px solid var(--separator)", background: on ? "var(--brand)" : "transparent", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
                      >
                        {on && <Icon name="check" size={16} stroke={2.8} />}
                      </button>
                      <span className="t-headline">第 {q.number} 题</span>
                      <SubjectChip subject={q.subject} small />
                      <span className="t-cap c-sec">{QTYPE_LABEL[q.questionType]}</span>
                      <span className="chip chip--sm" style={{ marginLeft: "auto", background: m.bg, color: m.color }}>
                        <Icon name={m.icon} size={12} stroke={2.4} />
                        {m.label}
                      </span>
                    </div>
                    <p className="t-body" style={{ whiteSpace: "pre-wrap" }}>{q.stemText}</p>
                    {q.options.length > 0 && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        {q.options.map((o, i) => (
                          <span key={i} className="t-sub" style={{ paddingLeft: 8 }}>{/^[A-D][.、．]/.test(o) ? o : `${String.fromCharCode(65 + i)}. ${o}`}</span>
                        ))}
                      </div>
                    )}
                    <div style={{ background: "var(--fill-light)", borderRadius: 10, padding: "8px 10px", display: "flex", flexDirection: "column", gap: 4 }}>
                      <span className="t-cap c-sec" style={{ fontWeight: 600 }}>学生作答（手写转写）</span>
                      <p className="t-sub" style={{ color: q.mark === "correct" ? "var(--mastered)" : "var(--wrong)", fontStyle: "italic", whiteSpace: "pre-wrap" }}>{q.studentAnswer || "（未作答）"}</p>
                      {q.uncertainSpans.length > 0 && <span className="t-cap" style={{ color: "var(--due)" }}>看不清：{q.uncertainSpans.join("、")}</span>}
                    </div>
                    {q.teacherNote && <span className="t-foot" style={{ color: "var(--wrong)" }}>老师批注：{q.teacherNote}</span>}
                    {q.mark !== "correct" && q.correctAnswer && (
                      <span className="t-foot c-sec">正确答案：<b style={{ color: "var(--label)" }}>{q.correctAnswer}</b></span>
                    )}
                    <button className="t-foot" style={{ color: "var(--brand)", fontWeight: 500, textAlign: "left", minHeight: 32 }} onClick={() => openPreview(q)}>对照原题截图</button>
                  </div>
                );
              })}
            </div>
          );
        })}

        <div className="bottom-bar">
          <Button onClick={importSelected} disabled={busy || selected.size === 0} style={{ flex: 1 }}>
            {busy ? "准备中…" : `收进错题本 · ${selected.size} 题`}
          </Button>
        </div>
      </div>

      <Sheet open={Boolean(preview)} onClose={() => setPreview(null)} title={preview ? `第 ${preview.number} 题 · 原题截图` : ""}>
        {previewSrc && <img src={previewSrc} alt="原题截图" style={{ width: "100%", borderRadius: 10, border: "1px solid var(--separator-light)" }} />}
        <Button variant="plain" onClick={() => setPreview(null)}>关闭</Button>
      </Sheet>
    </div>
  );
}
