import { formatDateTime, SUBJECT_LABEL } from "../lib/format";
import { useEffect, useMemo, useState } from "react";
import type { Subject } from "../api/types";
import { apiBlob } from "../api/client";
import { groupByKnowledge, groupBySubject, knowledgeKey, toBookItems, type ErrorItem } from "../lib/errors";
import { setLastExportAt } from "../lib/prefs";
import { validDigitized, type Paper } from "../lib/folders";
import { figureAt, figurePayload } from "../lib/figures";
import { exportPdf, haptic } from "../lib/native";
import { toast, toastError } from "../store/banner";
import { useExports } from "../store/exports";
import { Icon } from "./Icon";
import { Button, Sheet } from "./ui";
import { Tag } from "./v2";


/**
 * 导出面板：两种文件。
 * 错题本 = 横向打印，左半页空白重做、右半页错题修正；原始电子试卷 = 干净原卷 + 作答对照表。
 * 错题本可以按「学科 → 知识点」勾选导出范围，默认全选。
 * errors 是本次范围内的错题；papers 是本次范围内已扫描的试卷（错题库导出时不传，只出错题本）。
 */
export function ExportSheet({ open, onClose, title, subtitle, errors, papers }: { open: boolean; onClose: () => void; title: string; subtitle?: string; errors: ErrorItem[]; papers?: Paper[] }) {
  const [kind, setKind] = useState<"book" | "paper">("book");
  const [withWrong, setWithWrong] = useState(true);
  const [withBlank, setWithBlank] = useState(true);
  const [busy, setBusy] = useState(false);
  const submitExport = useExports((s) => s.submit);
  // 导出范围：学科 → 知识点两级勾选，默认全选。记的是「去掉了哪些知识点」，题目变了新知识点也默认选上。
  // 每次打开面板重置，免得上次的选择把这次的题筛没了
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<Subject>>(new Set());
  const tree = useMemo(
    () => groupBySubject(errors).map(([sub, list]) => ({ sub, count: list.length, kps: groupByKnowledge(list).map(([name, l]) => ({ key: knowledgeKey(l[0]), name, count: l.length })) })),
    [errors],
  );
  useEffect(() => {
    if (!open) return;
    setExcluded(new Set());
    setExpanded(new Set(tree.length === 1 ? [tree[0].sub] : []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const kpTotal = tree.reduce((n, g) => n + g.kps.length, 0);
  const scoped = excluded.size ? errors.filter((e) => !excluded.has(knowledgeKey(e))) : errors;
  const picked = (g: (typeof tree)[number]) => g.kps.filter((k) => !excluded.has(k.key));
  const setKeys = (keys: string[], on: boolean) => setExcluded((prev) => { const next = new Set(prev); for (const k of keys) { if (on) next.delete(k); else next.add(k); } return next; });
  const toggleSubject = (g: (typeof tree)[number]) => setKeys(g.kps.map((k) => k.key), picked(g).length < g.kps.length);
  const toggleKp = (key: string) => setKeys([key], excluded.has(key));
  const toggleOpen = (sub: Subject) => setExpanded((prev) => { const next = new Set(prev); if (next.has(sub)) next.delete(sub); else next.add(sub); return next; });
  const allOn = excluded.size === 0;
  // PDF 副标题：整科选上写学科名，只选了部分写「化学 2 个知识点」
  const filterLabel = allOn ? "" : tree.map((g) => { const n = picked(g).length; return n === 0 ? "" : n === g.kps.length ? SUBJECT_LABEL[g.sub] : `${SUBJECT_LABEL[g.sub]} ${n} 个知识点`; }).filter(Boolean).join("、");

  const wrongErrors = scoped.filter((e) => e.kind !== "未作答");
  const blankErrors = scoped.filter((e) => e.kind === "未作答");
  const typed = scoped.filter((e) => (e.kind === "未作答" ? withBlank : withWrong));
  // 同一知识点的题排在一起（错得多的在前），导出的错题本按这个顺序分组、生成目录
  const chosen = groupByKnowledge(typed).flatMap(([, list]) => list);
  const scanned = (papers ?? []).filter((p) => validDigitized(p.digitized));
  const bookPages = Math.max(1, Math.ceil(toBookItems(chosen).length / 3));

  // 请求体：错题本 = 按知识点排好的题 + 裁好的插图；电子试卷 = 扫描结果原样 + 插图
  const bookBody = async () => {
    const books = toBookItems(chosen);
    // 插图从原照片裁好一起发给服务器排版（同时最多解码两张原照片，见 figures.ts）
    const items = await Promise.all(books.map(async (b) => ({ ...b, figures: await Promise.all(b.figures.map(figurePayload)) })));
    const typeLabel = withWrong && withBlank ? "错题 + 未作答" : withBlank ? "只含未作答" : "只含错题";
    return { title: `${title} 错题本`, subtitle: [subtitle, filterLabel, `${chosen.length} 题`, typeLabel].filter(Boolean).join(" · "), items };
  };
  const paperBody = async () => {
    const papersBody = await Promise.all(
      scanned.map(async (p) => {
        const d = validDigitized(p.digitized)!;
        const pages = await Promise.all(
          d.pages.map(async (s, si) => ({
            ...s,
            blocks: await Promise.all(s.blocks.map(async (b, bi) => { const f = b.type === "figure" ? figureAt(p, si, bi) : null; return f ? { ...b, image: (await figurePayload(f)).image } : b; })),
          })),
        );
        return { title: `${title} · ${p.name}`, scannedAt: p.scannedAt ? formatDateTime(p.scannedAt) : "", pages, questions: d.questions };
      }),
    );
    return { title, papers: papersBody };
  };

  const run = async () => {
    if (kind === "book" && chosen.length === 0) return toast(allOn ? "这个范围里没有错题" : "还没选要导出的知识点");
    if (kind === "paper" && scanned.length === 0) return toast("还没有扫描过的试卷");
    setBusy(true);
    try {
      const body = kind === "book" ? await bookBody() : await paperBody();
      // 交给服务器后台生成：面板马上关掉，好了弹提醒，「我的导出」里能再下载
      const job = await submitExport({ kind, ...body });
      if (job) {
        if (kind === "book") await setLastExportAt();
        void haptic.success();
        if (job.status !== "done") toast("正在后台生成，好了会提醒你；也可以在「我的 › 我的导出」里查看");
        onClose();
        return;
      }
      // 服务器还没升级（没有后台导出）：照旧当场生成
      const blob = await apiBlob(kind === "book" ? "/api/digitize/book" : "/api/digitize/pdf", { method: "POST", body, timeoutMs: 180000 });
      await exportPdf(blob, kind === "book" ? `${title} 错题本.pdf` : `${title} 电子试卷.pdf`);
      if (kind === "book") await setLastExportAt();
      void haptic.success();
      onClose();
    } catch (e) {
      if (!/cancel/i.test(String((e as Error).message))) toastError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "0 2px" }}>
        <span className="tile tile--sm" style={{ background: "var(--brand-tint)", color: "var(--brand)" }}><Icon name="export" size={20} stroke={2.2} /></span>
        <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
          <h2 className="t-title3 ellipsis" style={{ fontWeight: 800 }}>导出「{title}」</h2>
          <span className="t-foot c-sec">生成 PDF 后可以直接打印、存到「文件」或发给老师</span>
        </div>
      </div>

      <button className="card card--row" style={{ border: kind === "book" ? "2px solid var(--brand)" : "2px solid transparent", boxShadow: kind === "book" ? "0 6px 16px rgba(47,111,237,.14)" : "none" }} onClick={() => setKind("book")} aria-pressed={kind === "book"}>
        <svg aria-hidden="true" width="64" height="50" viewBox="0 0 72 56" fill="none" style={{ flexShrink: 0 }}>
          <rect x="2" y="2" width="68" height="52" rx="6" fill="var(--card)" stroke="var(--brand)" strokeWidth="2" />
          <path d="M36 2v52" stroke="var(--brand)" strokeWidth="2" strokeDasharray="3 3" />
          <path d="M10 14h18M10 22h18M10 30h12" stroke="var(--label)" strokeWidth="2" strokeLinecap="round" />
          <path d="M44 14h16" stroke="var(--wrong)" strokeWidth="2" strokeLinecap="round" />
          <path d="M44 22h12" stroke="var(--mastered)" strokeWidth="2" strokeLinecap="round" />
          <path d="M44 30h18M44 38h14" stroke="var(--separator)" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
          <span className="t-headline" style={{ display: "flex", alignItems: "center", gap: 6 }}>错题本 <Tag kind="accent">推荐</Tag></span>
          <span className="t-foot c-sec">自动生成目录，按知识点排好。左边空白重做，右边错题修正，对折就能自测。</span>
          <span className="t-cap c-sec">{chosen.length} 题 · 约 {bookPages} 页</span>
        </span>
        <Icon name={kind === "book" ? "checkcircle" : "chevron-right"} size={22} style={{ color: kind === "book" ? "var(--brand)" : "var(--tertiary)" }} />
      </button>

      {papers && (
        <button className="card card--row" style={{ border: kind === "paper" ? "2px solid var(--brand)" : "2px solid transparent" }} onClick={() => setKind("paper")} aria-pressed={kind === "paper"}>
          <svg aria-hidden="true" width="64" height="50" viewBox="0 0 72 56" fill="none" style={{ flexShrink: 0 }}>
            <rect x="18" y="2" width="36" height="52" rx="5" fill="var(--paper, #fffdf8)" stroke="var(--tertiary)" strokeWidth="2" />
            <path d="M28 10h16" stroke="var(--label)" strokeWidth="2.4" strokeLinecap="round" />
            <path d="M24 19h24M24 26h24M24 33h16M24 40h24M24 47h12" stroke="var(--separator)" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
            <span className="t-headline">原始电子试卷</span>
            <span className="t-foot c-sec">还原后的干净原卷，空格留白，可以整张再做一遍；附作答与批改对照表。</span>
            <span className="t-cap c-sec">{scanned.length} 张试卷</span>
          </span>
          <Icon name={kind === "paper" ? "checkcircle" : "chevron-right"} size={22} style={{ color: kind === "paper" ? "var(--brand)" : "var(--tertiary)" }} />
        </button>
      )}

      {kind === "book" && kpTotal > 1 && (
        <div className="export-filter">
          <span className="export-filter__head">
            <Icon name="list" size={14} stroke={2.2} />导出范围
            <button className="export-filter__all" onClick={() => setExcluded(allOn ? new Set(tree.flatMap((g) => g.kps.map((k) => k.key))) : new Set())}>{allOn ? "全不选" : "全选"}</button>
          </span>
          <div className="export-tree">
            {tree.map((g) => {
              const n = picked(g).length;
              const state = n === 0 ? "none" : n === g.kps.length ? "all" : "some";
              const isOpen = expanded.has(g.sub);
              return (
                <div key={g.sub} className={`export-tree__group${isOpen ? " open" : ""}`}>
                  <div className="export-tree__row">
                    <button className={`export-check export-check--${state}`} role="checkbox" aria-checked={state === "all" ? true : state === "some" ? "mixed" : false} aria-label={`导出${SUBJECT_LABEL[g.sub]}全部知识点`} onClick={() => toggleSubject(g)}>
                      {state !== "none" && <Icon name={state === "all" ? "check" : "minus"} size={14} stroke={3} />}
                    </button>
                    <button className="export-tree__title" aria-expanded={isOpen} onClick={() => toggleOpen(g.sub)}>
                      <span className="export-tree__name">{SUBJECT_LABEL[g.sub]}</span>
                      <span className="export-tree__meta">{g.count} 题 · {state === "all" ? `全部 ${g.kps.length} 个知识点` : `已选 ${n}/${g.kps.length} 个知识点`}</span>
                      <Icon name="chevron-down" size={16} stroke={2.4} className="export-tree__chev" />
                    </button>
                  </div>
                  {isOpen && (
                    <div className="export-filter__chips export-tree__kps">
                      {g.kps.map((k) => (
                        <button key={k.key} className={`chip chip--select export-filter__kp${excluded.has(k.key) ? "" : " on"}`} aria-pressed={!excluded.has(k.key)} onClick={() => toggleKp(k.key)} title={k.name}>
                          <span className="ellipsis">{k.name}</span><span className="export-filter__n">{k.count}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {kind === "book" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "0 2px" }}>
          <span className="t-foot" style={{ fontWeight: 700, color: "var(--secondary)", display: "inline-flex", alignItems: "center", gap: 6 }}><Icon name="list" size={14} stroke={2.2} />错题本里放哪些题</span>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className={`chip chip--select${withWrong ? " on" : ""}`} aria-pressed={withWrong} onClick={() => setWithWrong((v) => !(v && withBlank) ? true : !v)} style={{ gap: 6 }}>
              <Icon name="xcircle" size={14} stroke={2.2} />错题 {wrongErrors.length}
            </button>
            <button className={`chip chip--select${withBlank ? " on" : ""}`} aria-pressed={withBlank} onClick={() => setWithBlank((v) => !(v && withWrong) ? true : !v)} style={{ gap: 6 }}>
              <Icon name="alert" size={14} stroke={2.2} />未作答 {blankErrors.length}
            </button>
          </div>
        </div>
      )}

      <Button icon="printer" onClick={run} disabled={busy}>{busy ? "正在提交…" : "生成 PDF"}</Button>
      <Button variant="plain" onClick={onClose} style={{ height: 44 }}>取消</Button>
    </Sheet>
  );
}
