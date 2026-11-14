import { useEffect, useMemo, useState } from "react";
import { Picker, Text, View } from "@tarojs/components";
import Taro, { useRouter } from "@tarojs/taro";
import { ColorIcon } from "../../components/ColorIcon";
import { RemindChip, RemindSheet, useTick } from "../../components/homework";
import { Button, SubjectTile } from "../../components/ui";
import { errorText } from "../../lib/api";
import { toast } from "../../lib/hooks";
import { defaultStart, groupBySubject, hwSubjectLabel, loadDay, orderOf, schedule, tileSubject, useHomework, type HwItem } from "../../lib/homework";
import { useThemeClass } from "../../lib/theme";

const back = () => void Taro.navigateBack().catch(() => Taro.redirectTo({ url: "/pages/homework/index" }));

/** 06 设置提醒时间（和 App 一致）：一键从几点开始按预计用时排好；每一项也可以单独改 */
export default function HomeworkRemind() {
  const tc = useThemeClass();
  const day = useRouter().params.day || undefined;
  const { data } = useHomework();
  const [editing, setEditing] = useState<HwItem | null>(null);
  const [busy, setBusy] = useState(false);
  const now = useTick();
  useEffect(() => {
    if (!data || (day && data.day !== day)) loadDay(day).catch((e) => toast(errorText(e)));
  }, [day]);

  const todo = useMemo(() => data?.items.filter((it) => it.status === "todo") ?? [], [data]);
  const auto = todo.some((it) => it.remindAt || it.chain);
  const firstAt = todo.find((it) => it.remindAt)?.remindAt;
  const [from, setFrom] = useState("");
  useEffect(() => {
    if (data && !from) setFrom(firstAt ?? defaultStart(data.now));
  }, [data, firstAt, from]);

  const run = async (start: string | null) => {
    setBusy(true);
    try {
      await schedule(start, data?.day);
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (!data) {
    return (
      <View className={"page" + tc}>
        <View className="empty"><View className="spinner spinner--lg" /></View>
      </View>
    );
  }
  const first = data.summary.nextId ? data.items.find((it) => it.id === data.summary.nextId) : null;
  const flat = groupBySubject(data.items).flatMap((g) => g.items);

  return (
    <View className={"page hw-page" + tc} style={{ paddingBottom: "calc(90px + env(safe-area-inset-bottom))" }}>
      <View className="hw-auto">
        <View className="hw-auto__h">
          <ColorIcon name="remind" size={40} />
          <View>
            <Text className="hw-auto__b">到点提醒，自动开始计时</Text>
            <Text className="hw-auto__s">打开小程序时已经在计时了</Text>
          </View>
        </View>
        <View className="hw-auto__row">
          <Text>从</Text>
          <Picker
            mode="time"
            value={from || "18:00"}
            onChange={(e) => {
              const v = String(e.detail.value);
              setFrom(v);
              if (auto) void run(v);
            }}
          >
            <Text className="hw-auto__time">{from}</Text>
          </Picker>
          <Text>开始，按用时排好</Text>
          <View className={`hw-switch${auto ? " hw-switch--on" : ""}`} onClick={() => !busy && todo.length && void run(auto ? null : from)} />
        </View>
      </View>
      {groupBySubject(data.items).map((g) => (
        <View key={g.subject}>
          <View className="hw-sech">
            <SubjectTile subject={tileSubject(g.subject)} size="xs" />
            <Text>{hwSubjectLabel(g.subject)}</Text>
            <Text className="hw-sech__n">{g.items.length} 项</Text>
          </View>
          <View className="hw-list">
            {g.items.map((it) => (
              <View key={it.id} className={`hw-row${it.status === "done" ? " hw-row--done" : ""}`} hoverClass="list-row--hover" onClick={() => it.status === "todo" && setEditing(it)}>
                <View className="hw-main">
                  <Text className="hw-title ellipsis">{it.title}</Text>
                  <Text className="hw-sub">预计 {it.est} 分钟</Text>
                </View>
                <RemindChip item={it} now={now} />
              </View>
            ))}
          </View>
        </View>
      ))}
      <View className="bottom-bar">
        <Button className="flex1" onClick={back}>
          {first && data.summary.nextAt ? `保存 · ${data.summary.nextAt} 自动开始第 ${orderOf(data.items, first.id)} 项` : "保存"}
        </Button>
      </View>
      <RemindSheet item={editing} first={!!editing && flat[0]?.id === editing.id} onClose={() => setEditing(null)} />
    </View>
  );
}
