import { useEffect, useState } from "react";
import { Input, Text, View } from "@tarojs/components";
import Taro, { useDidShow, usePullDownRefresh, useRouter } from "@tarojs/taro";
import { Buddy } from "../../components/Buddy";
import { ColorIcon } from "../../components/ColorIcon";
import { HomeworkLoginGate, RemindChip, RemindSheet, StartClock, useTick } from "../../components/homework";
import { Icon } from "../../components/Icon";
import { Button, SubjectTile } from "../../components/ui";
import { errorText } from "../../lib/api";
import { isLoggedIn } from "../../lib/auth";
import { pickPhotos } from "../../lib/capture";
import {
  ack, act, alarmKey, clockOf, dayLabel, groupBySubject, hourMin, hwSubjectLabel, liveUsed, loadDay, mmss, msUntil, nextTodo, orderOf, parseHomework, parseLocal,
  serverClockOffset, setDraft, shiftDay, tileSubject, useHomework, type HwDay, type HwItem,
} from "../../lib/homework";
import { toast } from "../../lib/hooks";
import { C, useThemeClass } from "../../lib/theme";

/** 作业流程里的页面互相都用 redirectTo：页面栈一直是「首页 → 当前这一页」，不管走到哪一步，返回都直接回首页 */
const go = (url: string) => Taro.redirectTo({ url });

/** 今天作业计划（和 App 一致）：清单（没有事项时是录入页），底下一直有录入条；到点自动开始的项弹全屏提醒 */
export default function Homework() {
  const tc = useThemeClass();
  const router = useRouter();
  const [day, setDay] = useState<string | undefined>(router.params.day || undefined);
  const { data, fetchedAt } = useHomework();
  const [parsing, setParsing] = useState<{ photos: number; text: boolean } | null>(null);
  const [text, setText] = useState("");
  const logged = isLoggedIn();
  const shown = data && (!day || data.day === day) ? data : null;
  const running = shown?.items.some((it) => it.status === "running") ?? false;
  const now = useTick(running);

  const load = () => (isLoggedIn() ? loadDay(day).catch((e) => toast(errorText(e))) : Promise.resolve());
  useEffect(() => {
    void load();
  }, [day]);
  useDidShow(() => void load());
  usePullDownRefresh(async () => {
    await load();
    Taro.stopPullDownRefresh();
  });
  // 停在这一页时，到下一项的提醒时间刷新一次（服务端那边就自动开始了）
  useEffect(() => {
    if (!shown?.summary.nextAt || shown.day !== shown.today) return;
    const wait = msUntil(shown, fetchedAt, shown.summary.nextAt) + 1500;
    if (wait > 6 * 3600 * 1000) return;
    const t = setTimeout(() => void load(), Math.max(1000, wait));
    return () => clearTimeout(t);
  }, [shown, fetchedAt]);

  if (!logged) return <HomeworkLoginGate />;

  const submit = async (images: string[]) => {
    const words = text.trim();
    if (!words && !images.length) return;
    setParsing({ photos: images.length, text: !!words });
    try {
      const res = await parseHomework(words, images, shown?.day);
      if (!res.items.length && !res.planDue.length) {
        toast(images.length ? "照片里没认出作业，换一张或者打字试试" : "没认出作业，换个说法试试");
        return;
      }
      setDraft(res.items, res.planDue);
      setText("");
      void go(`/pages/homework-confirm/index${shown ? `?day=${shown.day}` : ""}`);
    } catch (e) {
      toast(errorText(e));
    } finally {
      setParsing(null);
    }
  };
  const photos = async (source: "camera" | "album") => {
    try {
      const list = await pickPhotos(source);
      if (list.length) await submit(list.slice(0, 6));
    } catch (e) {
      toast(errorText(e));
    }
  };

  if (parsing) return <Parsing tc={tc} photos={parsing.photos} text={parsing.text} />;

  return (
    <View className={"page hw-page" + tc}>
      {!shown && (
        <View className="empty">
          <View className="spinner spinner--lg" />
        </View>
      )}
      {shown && (
        <>
          <View className="hw-head">
            <View className="hw-day">
              <View hoverClass="hw-press" onClick={() => setDay(shiftDay(shown.day, -1))}>
                <Icon name="chevron-left" size={14} color={C.tertiary} stroke={2.4} />
              </View>
              <Text>{dayLabel(shown.day)}</Text>
              {shown.day !== shown.today && (
                <View hoverClass="hw-press" onClick={() => setDay(shiftDay(shown.day, 1) === shown.today ? undefined : shiftDay(shown.day, 1))}>
                  <Icon name="chevron-right" size={14} color={C.tertiary} stroke={2.4} />
                </View>
              )}
            </View>
            {shown.items.length > 0 && <Headline data={shown} fetchedAt={fetchedAt} now={now} />}
          </View>
          {shown.items.length === 0 ? <EmptyDay /> : shown.summary.allDone ? <AllDone data={shown} /> : <ItemList data={shown} now={now} />}
        </>
      )}
      <View className="bottom-bar" style={{ flexDirection: "column" }}>
        {shown && <MainAction data={shown} />}
        <View className="hw-dock">
          {!shown?.items.length && <Text className="hw-dock__hint">打一句、拍一张，或者直接打字；粘贴一大段会自动拆成多项</Text>}
          <View className="hw-input">
            <Input className="hw-input__field" value={text} onInput={(e) => setText(e.detail.value)} placeholder="添加一项，如「背 U6 单词」" confirmType="send" onConfirm={() => void submit([])} maxlength={4000} />
            {text.trim() ? (
              <View className="hw-ib hw-ib--send" hoverClass="hw-press" onClick={() => void submit([])}>
                <Icon name="check" size={20} color="#ffffff" stroke={2.6} />
              </View>
            ) : (
              <>
                <View className="hw-ib" hoverClass="hw-press" onClick={() => void photos("camera")}>
                  <Icon name="camera" size={20} color={C.brand} />
                </View>
                <View className="hw-ib" hoverClass="hw-press" onClick={() => void photos("album")}>
                  <Icon name="photo" size={20} color={C.brand} />
                </View>
              </>
            )}
          </View>
        </View>
      </View>
      {shown && <Alarm data={shown} fetchedAt={fetchedAt} />}
    </View>
  );
}

function Headline({ data, fetchedAt, now }: { data: HwDay; fetchedAt: number; now: number }) {
  const s = data.summary;
  const used = data.items.reduce((n, it) => n + liveUsed(it, fetchedAt, now), 0);
  const nextIdx = s.nextId ? orderOf(data.items, s.nextId) : 0;
  const started = !!(s.done > 0 || s.currentId || s.startedAt);
  if (s.allDone) return null;
  return (
    <>
      <View className="hw-big">
        <Text>{started ? `还剩 ${s.left} 项` : `共 ${s.total} 项`}</Text>
        <Text className="hw-big__small">{started ? `做完 ${s.done} 项` : "还没开始"}</Text>
      </View>
      {started && (
        <View className="hw-bar">
          <View className="hw-bar__in" style={{ width: `${(s.done / Math.max(1, s.total)) * 100}%` }} />
        </View>
      )}
      <View className="hw-meta">
        {started && (
          <View className="hw-meta__i">
            <Icon name="clock" size={13} color={C.secondary} stroke={2.2} />
            <Text>已用 {hourMin(used)}</Text>
          </View>
        )}
        {s.nextAt && (
          <View className="hw-meta__i">
            <ColorIcon name="remind" size={16} />
            <Text>
              {s.nextAt} 自动开始第 {nextIdx} 项
            </Text>
          </View>
        )}
      </View>
    </>
  );
}

function EmptyDay() {
  const ways: [string, string][] = [
    ["pencil", "「写周记，再做练习部分第 13 课」"],
    ["camera", "拍黑板、家校本，自动拆成一项一项"],
    ["photo", "群里老师发的作业截图"],
    ["document", "粘贴老师的消息，一段话也能拆开"],
  ];
  return (
    <>
      <View className="hw-empty">
        <Buddy scene="empty" size={120} />
        <Text className="hw-empty__b">今天要做什么？</Text>
        <Text className="t-sub">在下面打一句、拍一张，或者直接打字。</Text>
      </View>
      <View className="hw-ways">
        {ways.map(([icon, t]) => (
          <View key={t} className="hw-ways__r">
            <Icon name={icon as "pencil"} size={18} color={C.brand} />
            <Text>{t}</Text>
          </View>
        ))}
      </View>
    </>
  );
}

function ItemList({ data, now }: { data: HwDay; now: number }) {
  const [editing, setEditing] = useState<HwItem | null>(null);
  const groups = groupBySubject(data.items);
  const flat = groups.flatMap((g) => g.items);
  const canTime = data.day >= data.today;
  const toggle = async (it: HwItem) => {
    try {
      await act(it.id, it.status === "done" ? "undo" : "finish");
    } catch (e) {
      toast(errorText(e));
    }
  };
  return (
    <>
      {canTime && <StartClock data={data} />}
      {groups.map((g) => (
        <View key={g.subject}>
          <View className="hw-sech">
            <SubjectTile subject={tileSubject(g.subject)} size="xs" />
            <Text>{hwSubjectLabel(g.subject)}</Text>
            <Text className="hw-sech__n">{g.items.every((it) => it.status === "done") ? "做完了" : `${g.items.filter((it) => it.status !== "done").length} 项`}</Text>
          </View>
          <View className="hw-list">
            {g.items.map((it) => {
              const cur = it.status === "running" || it.status === "paused";
              return (
                <View key={it.id} className={`hw-row${it.status === "done" ? " hw-row--done" : ""}${cur ? " hw-row--current" : ""}`}>
                  <View className={`hw-check${it.status === "done" ? " hw-check--done" : cur ? " hw-check--run" : ""}`} onClick={() => void toggle(it)}>
                    {it.status === "done" && <Icon name="check" size={14} color="#ffffff" stroke={3} />}
                  </View>
                  <View className="hw-main" hoverClass="hw-press" onClick={() => void go(cur ? `/pages/homework-focus/index?id=${it.id}` : `/pages/homework-item/index?id=${it.id}`)}>
                    <Text className="hw-title ellipsis">{it.title}</Text>
                    {(it.planAssignmentId || (it.status === "done" && it.used > it.est * 60)) && (
                      <View className="hw-sub">
                        {it.planAssignmentId && <Text className="hw-teacher">学习计划</Text>}
                        {it.status === "done" && it.used > it.est * 60 && <Text className="hw-over">超 {Math.round(it.used / 60 - it.est)} 分</Text>}
                      </View>
                    )}
                  </View>
                  {it.status === "todo" && canTime ? (
                    <View className="hw-rmdbtn" hoverClass="hw-press" onClick={() => setEditing(it)}>
                      <RemindChip item={it} now={now} action />
                    </View>
                  ) : (
                    <RemindChip item={it} now={now} />
                  )}
                </View>
              );
            })}
          </View>
        </View>
      ))}
      {canTime && data.items.some((it) => it.status === "todo") && (
        <Text className="t-cap c-sec" style={{ padding: "8px 4px" }}>
          改顶部的开始时间，每一项跟着重排；某一项要单独改，点它右边的时间。
        </Text>
      )}
      <RemindSheet item={editing} first={!!editing && flat[0]?.id === editing.id} onClose={() => setEditing(null)} />
    </>
  );
}

function MainAction({ data }: { data: HwDay }) {
  const [busy, setBusy] = useState(false);
  const s = data.summary;
  if (!data.items.length || data.day !== data.today || s.allDone) return null;
  if (s.currentId) {
    const cur = data.items.find((it) => it.id === s.currentId)!;
    return (
      <Button icon="timer" onClick={() => void go(`/pages/homework-focus/index?id=${cur.id}`)}>
        {`${cur.status === "paused" ? "继续" : "回到计时"}：${cur.title}`}
      </Button>
    );
  }
  const next = nextTodo(data.items);
  if (!next) return null;
  const start = async () => {
    setBusy(true);
    try {
      await act(next.id, "start");
      void go(`/pages/homework-focus/index?id=${next.id}`);
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button icon="play" disabled={busy} onClick={() => void start()}>
      {`${s.nextAt ? "不等了，现在开始" : "现在就开始"}${s.left === 1 ? "最后一项" : `第 ${orderOf(data.items, next.id)} 项`}`}
    </Button>
  );
}

function AllDone({ data }: { data: HwDay }) {
  const s = data.summary;
  const max = Math.max(...data.items.map((it) => Math.max(it.used, it.est * 60)), 60);
  return (
    <>
      <View className="hw-alldone">
        <ColorIcon name="done" size={72} />
        <Text className="hw-alldone__b">作业全做完了</Text>
        <Text className="hw-alldone__s">
          {clockOf(s.startedAt)} 开始，{clockOf(s.finishedAt)} 做完，计时已结束。
        </Text>
      </View>
      <View className="hw-stats">
        <View className="hw-stats__c"><Text className="hw-stats__b">{hourMin(s.used)}</Text><Text className="hw-stats__s">实际用时</Text></View>
        <View className="hw-stats__c"><Text className="hw-stats__b">{s.total} 项</Text><Text className="hw-stats__s">全部完成</Text></View>
        <View className="hw-stats__c"><Text className="hw-stats__b">{hourMin(s.est * 60)}</Text><Text className="hw-stats__s">预计用时</Text></View>
      </View>
      <View className="hw-bars">
        <View className="hw-bars__h"><Text>每项用时</Text><Text className="hw-bars__hs">竖线是预计用时</Text></View>
        {groupBySubject(data.items).flatMap((g) => g.items).map((it) => (
          <View key={it.id} className="hw-bars__r">
            <Text className="ellipsis">{it.title}</Text>
            <View className="hw-bars__t">
              <View className={`hw-bars__fill${it.used > it.est * 60 ? " hw-bars--over" : ""}`} style={{ width: `${(it.used / max) * 100}%` }} />
              <View className="hw-bars__mark" style={{ left: `${((it.est * 60) / max) * 100}%` }} />
            </View>
            <Text className="hw-bars__m">{Math.max(1, Math.round(it.used / 60))} 分</Text>
          </View>
        ))}
      </View>
      <Button variant="plain" onClick={() => void Taro.navigateBack().catch(() => Taro.switchTab({ url: "/pages/home/index" }))}>
        好的
      </Button>
    </>
  );
}

/** 04 正在生成清单 */
function Parsing({ tc, photos, text }: { tc: string; photos: number; text: boolean }) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const t = [setTimeout(() => setStep(1), 1800), setTimeout(() => setStep(2), 4500)];
    return () => t.forEach(clearTimeout);
  }, []);
  const what = [photos ? `${photos} 张照片` : "", text ? "1 段文字" : ""].filter(Boolean).join(" · ");
  const dot = (i: number) => (
    <View className={`hw-dot ${step > i ? "hw-dot--ok" : step === i ? "hw-dot--run" : "hw-dot--wait"}`}>{step > i && <Icon name="check" size={13} color="#ffffff" stroke={3} />}</View>
  );
  const rows: [number, string, string?][] = [
    [0, photos ? "看懂照片和文字" : "看懂这段话", what],
    [1, "拆成一项一项"],
    [2, "按学科分好"],
    [3, "对一下学习计划里的作业"],
  ];
  return (
    <View className={"page" + tc} style={{ gap: "16px" }}>
      <View className="hw-empty">
        <Buddy scene="scan" size={120} />
        <Text className="hw-empty__b">{photos ? "正在把照片拆成事项" : "正在拆成一项一项"}</Text>
        <Text className="t-sub">大约 10 秒，好了就自动打开清单。</Text>
      </View>
      <View className="hw-steps">
        {rows.map(([i, label, extra]) => (
          <View key={i} className={`hw-steps__r${i === 3 && step < 2 ? " hw-off" : ""}`}>
            {dot(i)}
            <Text className="flex1">{label}</Text>
            {extra && <Text className="t-cap c-sec">{extra}</Text>}
          </View>
        ))}
      </View>
    </View>
  );
}

/** 09b 到点提醒：到点自动开始了、还没看过的那一项，盖一层全屏提醒 */
function Alarm({ data, fetchedAt }: { data: HwDay; fetchedAt: number }) {
  const { acked } = useHomework();
  const [busy, setBusy] = useState(false);
  const running = data.day === data.today ? data.items.find((it) => it.status === "running" && it.autoStarted) ?? null : null;
  const fresh = running?.startedAt ? parseLocal(running.startedAt) > Date.now() + serverClockOffset(data, fetchedAt) - 2 * 3600 * 1000 : false;
  const show = !!running && fresh && !acked[alarmKey(running)];
  const now = useTick(show);
  useEffect(() => {
    if (show) void Taro.vibrateLong().catch(() => undefined);
  }, [show]);
  if (!show || !running) return null;
  const later = async () => {
    setBusy(true);
    try {
      await act(running.id, "snooze", { minutes: 10 });
      ack(alarmKey(running));
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <View className="hw-alarm" catchMove>
      <View className="hw-alarm__icon">
        <ColorIcon name="remind" size={92} />
      </View>
      <Text className="hw-alarm__sub">
        {hwSubjectLabel(running.subject)} · 第 {orderOf(data.items, running.id)} 项 / 共 {data.items.length} 项
      </Text>
      <Text className="hw-alarm__time">{running.chain ? "接着做" : running.remindAt ?? clockOf(running.startedAt)}</Text>
      <Text className="hw-alarm__title">{running.title}</Text>
      <View className="hw-alarm__run">
        <View className="hw-alarm__dot" />
        <Text>已自动开始计时 {mmss(liveUsed(running, fetchedAt, now))}</Text>
      </View>
      <View className="hw-alarm__btns">
        <View
          className="hw-alarm__ok"
          hoverClass="hw-press"
          onClick={() => {
            ack(alarmKey(running));
            void go(`/pages/homework-focus/index?id=${running.id}`);
          }}
        >
          <Text>好的，开始做</Text>
        </View>
        <View className="hw-alarm__later" hoverClass="hw-press" onClick={() => !busy && void later()}>
          <Text>晚 10 分钟再开始</Text>
        </View>
      </View>
    </View>
  );
}
