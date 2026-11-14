import { useEffect, useMemo, useRef, useState } from "react";
import { Picker, Text, View } from "@tarojs/components";
import Taro, { useRouter } from "@tarojs/taro";
import { ColorIcon } from "../../components/ColorIcon";
import { Icon } from "../../components/Icon";
import { RemindChip, RemindSheet, useTick } from "../../components/homework";
import { Button, SubjectTile } from "../../components/ui";
import { errorText } from "../../lib/api";
import { toast } from "../../lib/hooks";
import { defaultStart, groupBySubject, liveNow, hwSubjectLabel, loadDay, orderOf, schedule, tileSubject, useHomework, type HwItem } from "../../lib/homework";
import { C, useThemeClass } from "../../lib/theme";

/** 「保存」回清单；左上角返回直接回首页（页面栈里只有首页和这一页） */
const toList = () => void Taro.redirectTo({ url: "/pages/homework/index" });

/** 06 提醒时间（和 App 一致）：顶部一个时钟定开始时间，一进来就按预计用时把每一项排好，改时钟立刻重排；每一项也可以单独改 */
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
  const { fetchedAt } = useHomework();
  const [from, setFrom] = useState("");
  useEffect(() => {
    if (data && !from) setFrom(firstAt ?? (data.day === data.today ? defaultStart(liveNow(data.now, fetchedAt)) : "18:00"));
  }, [data, firstAt, from, fetchedAt]);

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

  // 一进来就按顶部的开始时间把每一项排好（一项都还没设提醒时）；不想要可以关掉开关，或单独改某一项（和 App 一致）
  const autoTried = useRef(false);
  useEffect(() => {
    if (!data || !from || autoTried.current || (day && data.day !== day)) return;
    autoTried.current = true;
    if (todo.length && !auto) void run(from);
  }, [data, from]);

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
          <Picker
            mode="time"
            value={from || "18:00"}
            onChange={(e) => {
              const v = String(e.detail.value);
              setFrom(v);
              void run(v);
            }}
          >
            <View className="hw-clock">
              <Icon name="clock" size={18} color={C.brand} stroke={2.4} />
              <Text className="hw-clock__t">{from}</Text>
            </View>
          </Picker>
          <View className="hw-auto__txt">
            <Text className="hw-auto__txtb">开始</Text>
            <Text>每一项按预计用时自动排好</Text>
          </View>
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
                <RemindChip item={it} now={now} action={it.status === "todo"} />
              </View>
            ))}
          </View>
        </View>
      ))}
      <View className="bottom-bar">
        <Button className="flex1" onClick={toList}>
          {first && data.summary.nextAt ? `保存 · ${data.summary.nextAt} 自动开始第 ${orderOf(data.items, first.id)} 项` : "保存"}
        </Button>
      </View>
      <RemindSheet item={editing} first={!!editing && flat[0]?.id === editing.id} onClose={() => setEditing(null)} />
    </View>
  );
}
