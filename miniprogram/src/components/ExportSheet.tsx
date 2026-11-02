import { useEffect, useMemo, useState } from "react";
import { Text, View } from "@tarojs/components";
import Taro from "@tarojs/taro";
import type { ErrorItem } from "../lib/errors";
import { groupByKnowledge, groupBySubject, knowledgeKey, toBookItems } from "../lib/errors";
import { bookBody, paperBody, runExport } from "../lib/export";
import { SUBJECT_LABEL } from "../lib/format";
import { validDigitized } from "../lib/logic";
import type { Paper } from "../lib/store";
import type { Subject } from "../lib/types";
import { C } from "../lib/theme";
import { Icon } from "./Icon";
import { Button, Sheet, Tag } from "./ui";

/**
 * 导出面板（和 App 一致）：两种文件。
 * 错题本 = 横向打印，左半页空白重做、右半页错题修正；原始电子试卷 = 干净原卷 + 作答对照表。
 * 错题本可以按「学科 → 知识点」勾选导出范围，默认全选。papers 不传时只出错题本。
 */
export function ExportSheet({ open, onClose, title, subtitle, errors, papers }: { open: boolean; onClose: () => void; title: string; subtitle?: string; errors: ErrorItem[]; papers?: Paper[] }) {
  const [kind, setKind] = useState<"book" | "paper">("book");
  const [withWrong, setWithWrong] = useState(true);
  const [withBlank, setWithBlank] = useState(true);
  const [busy, setBusy] = useState(false);
  // 导出范围：记的是「去掉了哪些知识点」，题目变了新知识点也默认选上。每次打开面板重置
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<Subject>>(new Set());
  const tree = useMemo(() => groupBySubject(errors).map(([sub, list]) => ({ sub, count: list.length, kps: groupByKnowledge(list).map(([name, l]) => ({ key: knowledgeKey(l[0]), name, count: l.length })) })), [errors]);
  useEffect(() => {
    if (!open) return;
    setExcluded(new Set());
    setExpanded(new Set(tree.length === 1 ? [tree[0].sub] : []));
  }, [open]);

  const kpTotal = tree.reduce((n, g) => n + g.kps.length, 0);
  const scoped = excluded.size ? errors.filter((e) => !excluded.has(knowledgeKey(e))) : errors;
  const picked = (g: (typeof tree)[number]) => g.kps.filter((k) => !excluded.has(k.key));
  const setKeys = (keys: string[], on: boolean) =>
    setExcluded((prev) => {
      const next = new Set(prev);
      for (const k of keys) {
        if (on) next.delete(k);
        else next.add(k);
      }
      return next;
    });
  const toggleSubject = (g: (typeof tree)[number]) => setKeys(g.kps.map((k) => k.key), picked(g).length < g.kps.length);
  const toggleKp = (key: string) => setKeys([key], excluded.has(key));
  const toggleOpen = (sub: Subject) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(sub)) next.delete(sub);
      else next.add(sub);
      return next;
    });
  const allOn = excluded.size === 0;
  // PDF 副标题：整科选上写学科名，只选了部分写「化学 2 个知识点」
  const filterLabel = allOn
    ? ""
    : tree
        .map((g) => {
          const n = picked(g).length;
          return n === 0 ? "" : n === g.kps.length ? SUBJECT_LABEL[g.sub] : `${SUBJECT_LABEL[g.sub]} ${n} 个知识点`;
        })
        .filter(Boolean)
        .join("、");

  const wrongCount = scoped.filter((e) => e.kind !== "未作答").length;
  const blankCount = scoped.length - wrongCount;
  const typed = scoped.filter((e) => (e.kind === "未作答" ? withBlank : withWrong));
  // 同一知识点的题排在一起（错得多的在前），导出的错题本按这个顺序分组、生成目录
  const chosen = groupByKnowledge(typed).flatMap(([, list]) => list);
  const scanned = (papers ?? []).filter((p) => validDigitized(p.digitized));
  const bookPages = Math.max(1, Math.ceil(toBookItems(chosen).length / 3));

  const run = async () => {
    if (busy) return;
    if (kind === "book" && chosen.length === 0) {
      void Taro.showToast({ title: allOn ? "这个范围里没有错题" : "还没选要导出的知识点", icon: "none" });
      return;
    }
    if (kind === "paper" && scanned.length === 0) {
      void Taro.showToast({ title: "还没有扫描过的试卷", icon: "none" });
      return;
    }
    setBusy(true);
    const typeLabel = withWrong && withBlank ? "错题 + 未作答" : withBlank ? "只含未作答" : "只含错题";
    const ok =
      kind === "book"
        ? await runExport("book", () => bookBody(title, [subtitle, filterLabel, `${chosen.length} 题`, typeLabel].filter(Boolean).join(" · "), chosen), `${title} 错题本.pdf`)
        : await runExport("paper", () => paperBody(title, scanned), `${title} 电子试卷.pdf`);
    setBusy(false);
    if (ok) onClose();
  };

  return (
    <Sheet open={open} onClose={onClose}>
      <View className="row-center gap12">
        <View className="tile tile--sm" style={{ background: C.brandTint }}>
          <Icon name="export" size={20} color={C.brand} stroke={2.2} />
        </View>
        <View className="flex1 col gap2 minw0">
          <Text className="t-title3 ellipsis xb">导出「{title}」</Text>
          <Text className="t-foot c-sec">生成 PDF 后可以转发给微信好友、打印或存到手机</Text>
        </View>
      </View>

      <View className={`card card--row pick${kind === "book" ? " pick--on" : ""}`} style={{ background: C.fillLight }} onClick={() => setKind("book")}>
        <View className="flex1 col gap4 minw0">
          <View className="row-center gap6">
            <Text className="t-headline">错题本</Text>
            <Tag kind="accent" icon={null}>
              推荐
            </Tag>
          </View>
          <Text className="t-foot c-sec">自动生成目录，按知识点排好。左边空白重做，右边错题修正，对折就能自测。</Text>
          <Text className="t-cap c-sec">
            {chosen.length} 题 · 约 {bookPages} 页
          </Text>
        </View>
        <Icon name={kind === "book" ? "checkcircle" : "chevron-right"} size={22} color={kind === "book" ? C.brand : C.tertiary} />
      </View>

      {papers && (
        <View className={`card card--row pick${kind === "paper" ? " pick--on" : ""}`} style={{ background: C.fillLight }} onClick={() => setKind("paper")}>
          <View className="flex1 col gap4 minw0">
            <Text className="t-headline">原始电子试卷</Text>
            <Text className="t-foot c-sec">还原后的干净原卷，空格留白，可以整张再做一遍；附作答与批改对照表。</Text>
            <Text className="t-cap c-sec">{scanned.length} 张试卷</Text>
          </View>
          <Icon name={kind === "paper" ? "checkcircle" : "chevron-right"} size={22} color={kind === "paper" ? C.brand : C.tertiary} />
        </View>
      )}

      {kind === "book" && kpTotal > 1 && (
        <View className="export-filter">
          <View className="export-filter__head">
            <Icon name="list" size={14} color={C.secondary} stroke={2.2} />
            <Text>导出范围</Text>
            <Text className="export-filter__all" onClick={() => setExcluded(allOn ? new Set(tree.flatMap((g) => g.kps.map((k) => k.key))) : new Set())}>
              {allOn ? "全不选" : "全选"}
            </Text>
          </View>
          <View className="export-tree">
            {tree.map((g) => {
              const n = picked(g).length;
              const state = n === 0 ? "none" : n === g.kps.length ? "all" : "some";
              const isOpen = expanded.has(g.sub);
              return (
                <View key={g.sub} className="export-tree__group">
                  <View className="export-tree__row">
                    <View className="export-check" onClick={() => toggleSubject(g)}>
                      <View className={`export-check__box${state !== "none" ? " export-check__box--on" : ""}`}>{state !== "none" && <Icon name={state === "all" ? "check" : "minus"} size={14} color="#ffffff" stroke={3} />}</View>
                    </View>
                    <View className="export-tree__title" onClick={() => toggleOpen(g.sub)}>
                      <Text className="export-tree__name">{SUBJECT_LABEL[g.sub]}</Text>
                      <Text className="export-tree__meta ellipsis">
                        {g.count} 题 · {state === "all" ? `全部 ${g.kps.length} 个知识点` : `已选 ${n}/${g.kps.length} 个知识点`}
                      </Text>
                      <Icon name={isOpen ? "chevron-up" : "chevron-down"} size={16} color={C.tertiary} stroke={2.4} />
                    </View>
                  </View>
                  {isOpen && (
                    <View className="export-tree__kps">
                      {g.kps.map((k) => (
                        <View key={k.key} className={`chip chip--card export-kp${excluded.has(k.key) ? "" : " chip--on"}`} onClick={() => toggleKp(k.key)}>
                          <Text className="ellipsis">{k.name}</Text>
                          <Text className="export-kp__n">{k.count}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        </View>
      )}

      {kind === "book" && (
        <View className="col gap8" style={{ padding: "0 2px" }}>
          <View className="export-filter__head">
            <Icon name="list" size={14} color={C.secondary} stroke={2.2} />
            <Text>错题本里放哪些题</Text>
          </View>
          <View className="row-wrap" style={{ gap: "8px" }}>
            <View className={`chip${withWrong ? " chip--on" : ""}`} onClick={() => setWithWrong(!(withWrong && withBlank) ? true : !withWrong)}>
              <Icon name="xcircle" size={14} color={withWrong ? C.brand : C.label} stroke={2.2} />
              <Text>错题 {wrongCount}</Text>
            </View>
            <View className={`chip${withBlank ? " chip--on" : ""}`} onClick={() => setWithBlank(!(withBlank && withWrong) ? true : !withBlank)}>
              <Icon name="alert" size={14} color={withBlank ? C.brand : C.label} stroke={2.2} />
              <Text>未作答 {blankCount}</Text>
            </View>
          </View>
        </View>
      )}

      <Button icon="printer" disabled={busy} onClick={run}>
        {busy ? "正在提交…" : "生成 PDF"}
      </Button>
      <Button variant="plain" onClick={onClose}>
        取消
      </Button>
    </Sheet>
  );
}
