import { useRef, useState } from "react";
import { Input, Text, View } from "@tarojs/components";
import Taro, { useRouter, useUnload } from "@tarojs/taro";
import { ColorIcon } from "../../components/ColorIcon";
import { Icon } from "../../components/Icon";
import { Button, Empty, SubjectTile } from "../../components/ui";
import { errorText } from "../../lib/api";
import { toast } from "../../lib/hooks";
import { addItems, dupDrafts, groupBySubject, HW_SUBJECTS, hwSubjectLabel, newKey, setDraft, tileSubject, useHomework, type DraftItem } from "../../lib/homework";
import { C, useThemeClass } from "../../lib/theme";

/** 05 识别结果：确认和修改（和 App 一致）。点一项改字、换学科；× 删除；学习计划里还没对上的作业可以勾上一起加 */
export default function HomeworkConfirm() {
  const tc = useThemeClass();
  const day = useRouter().params.day || undefined;
  const { draft, planDue, data: day0 } = useHomework();
  const [editing, setEditing] = useState<string | null>(null);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const leaving = useRef(false);
  // 不管从哪儿离开（左上角返回、系统返回键），已经录入的先存进清单，不丢（和 App 一致）
  const pending = useRef<() => Parameters<typeof addItems>[0]>(() => []);
  useUnload(() => {
    if (leaving.current) return;
    const items = pending.current();
    setDraft([], []);
    if (items.length) addItems(items, day).then((d) => toast(`已存进清单 ${items.length - (d.merged ?? 0)} 项${d.merged ? `，合并 ${d.merged} 项重复` : ""}`)).catch((e) => toast(errorText(e)));
  });

  if (!draft.length && !planDue.length && !leaving.current) {
    return (
      <View className={"page center-page" + tc}>
        <Empty art={<ColorIcon name="todo" size={72} />} title="没有要确认的作业">
          <Button size="sm" style={{ width: "auto", padding: "0 24px" }} onClick={() => void Taro.navigateBack()}>
            回清单
          </Button>
        </Empty>
      </View>
    );
  }

  const change = (key: string, patch: Partial<DraftItem>) => setDraft(draft.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  const remove = (key: string) => {
    setDraft(draft.filter((d) => d.key !== key));
    if (editing === key) setEditing(null);
  };
  const extra: DraftItem[] = planDue
    .filter((p) => picked[p.assignmentId])
    .map((p) => ({ key: newKey(), title: p.title, subject: p.subject ?? "other", est: 25, source: "plan", planAssignmentId: p.assignmentId, teacher: p.teacher }));
  // 和清单里已有的（含已做完的）文字一样的，加的时候会合并掉：先在这里标出来（和 App 一致）
  const existing = day0 && (day ? day0.day === day : day0.day === day0.today) ? day0.items : [];
  const dups = dupDrafts([...draft, ...extra], existing);
  const all = [...draft.filter((d) => d.title.trim()), ...extra];
  const total = all.filter((d) => !dups.has(d.key)).length;
  /** 按页面上看到的顺序（按学科分好）存，排时间、「接着上一项」都按这个顺序 */
  const toSave = () => groupBySubject([...draft.filter((d) => d.title.trim()), ...extra]).flatMap((g) => g.items).map(({ key: _key, teacher: _t, ...rest }) => rest);
  pending.current = toSave;

  const next = async () => {
    setBusy(true);
    try {
      const d = await addItems(toSave(), day);
      leaving.current = true;
      setDraft([], []);
      // 小程序跳页会把刚弹的提示盖掉：跳过去以后再提示
      void Taro.redirectTo({ url: `/pages/homework-remind/index${day ? `?day=${day}` : ""}` }).then(() => { if (d.merged) toast(`已合并 ${d.merged} 项重复`); /* 小程序的提示只放得下两行，不列名字 */ });
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View className={"page hw-page" + tc} style={{ paddingBottom: "calc(90px + env(safe-area-inset-bottom))" }}>
      <View className="hw-banner">
        <ColorIcon name="todo" size={40} />
        <View className="col gap2">
          <Text className="hw-banner__b">识别出 {draft.length} 项，已按学科分好</Text>
          <Text className="hw-banner__s">{dups.size ? `其中 ${dups.size} 项清单里已经有了，会自动合并` : "点一项可以改字、换学科；点 × 删掉"}</Text>
        </View>
      </View>
      {groupBySubject(draft).map((g) => (
        <View key={g.subject}>
          <View className="hw-sech">
            <SubjectTile subject={tileSubject(g.subject)} size="xs" />
            <Text>{hwSubjectLabel(g.subject)}</Text>
            <Text className="hw-sech__n">{g.items.length} 项</Text>
          </View>
          <View className="hw-list">
            {g.items.map((d) =>
              editing === d.key ? (
                <View key={d.key} className="hw-edit">
                  <Input className="hw-edit__input" focus value={d.title} maxlength={60} onInput={(e) => change(d.key, { title: e.detail.value })} />
                  <View className="hw-chips">
                    <Text className="t-cap c-sec">学科</Text>
                    {HW_SUBJECTS.map((s) => (
                      <Text key={s} className={`hw-chip${d.subject === s ? " hw-chip--on" : ""}`} onClick={() => change(d.key, { subject: s })}>
                        {hwSubjectLabel(s)}
                      </Text>
                    ))}
                  </View>
                  <View className="row-between">
                    <View className="row-center" style={{ gap: "4px" }} onClick={() => remove(d.key)}>
                      <Icon name="trash" size={14} color={C.wrong} />
                      <Text className="t-foot" style={{ color: C.wrong }}>删除</Text>
                    </View>
                    <Text className="t-foot" style={{ color: C.brand, fontWeight: 700 }} onClick={() => setEditing(null)}>
                      完成
                    </Text>
                  </View>
                </View>
              ) : (
                <View key={d.key} className="hw-row">
                  <View className="hw-main" onClick={() => setEditing(d.key)}>
                    <Text className="hw-title ellipsis">{d.title || "（空）"}</Text>
                    {dups.has(d.key) && (
                      <View className="hw-sub">
                        <Text className="hw-dup">清单里已有，会合并</Text>
                      </View>
                    )}
                    {d.planAssignmentId && (
                      <View className="hw-sub">
                        <Text className="hw-teacher">对上了{d.teacher || "老师"}布置的作业</Text>
                      </View>
                    )}
                  </View>
                  <View className="hw-x" onClick={() => remove(d.key)}>
                    <Icon name="xmark" size={13} color={C.tertiary} stroke={2.6} />
                  </View>
                </View>
              ),
            )}
          </View>
        </View>
      ))}
      {planDue.length > 0 && (
        <View className="hw-plan" style={{ marginTop: "10px" }}>
          <Text className="hw-plan__h">学习计划里今天还有 {planDue.length} 份作业</Text>
          {planDue.map((p) => (
            <View key={p.assignmentId} className="hw-plan__r" onClick={() => setPicked({ ...picked, [p.assignmentId]: !picked[p.assignmentId] })}>
              <View className={`hw-cb${picked[p.assignmentId] ? " hw-cb--on" : ""}`}>{picked[p.assignmentId] && <Icon name="check" size={12} color="#ffffff" stroke={3} />}</View>
              <View className="col minw0 flex1">
                <Text className="hw-title ellipsis">{p.title}</Text>
                <Text className="t-cap c-sec ellipsis">
                  {p.planName} · {p.teacher}
                </Text>
              </View>
            </View>
          ))}
        </View>
      )}
      <View className="bottom-bar">
        <Button className="flex1" disabled={busy || all.length === 0} onClick={() => void next()}>
          {total ? `下一步：设置提醒时间 · ${total} 项` : "都已在清单里，下一步"}
        </Button>
      </View>
    </View>
  );
}
