import { useEffect, useState } from "react";
import { Image, Input, Text, View } from "@tarojs/components";
import Taro, { useRouter } from "@tarojs/taro";
import { ColorIcon } from "../../components/ColorIcon";
import { RemindSheet } from "../../components/homework";
import { Icon } from "../../components/Icon";
import { Button, Empty, Sheet, SubjectTile } from "../../components/ui";
import { errorText } from "../../lib/api";
import { toast } from "../../lib/hooks";
import { act, clockOf, deleteItem, groupBySubject, HW_SUBJECTS, hwSubjectLabel, loadDay, minSec, orderOf, tileSubject, updateItem, useHomework } from "../../lib/homework";
import { C, useThemeClass } from "../../lib/theme";

/** 08 点开一项（和 App 一致）：开始前看一眼、改提醒时间、改字 / 学科、删除；做完的看用时和完成照片 */
export default function HomeworkItem() {
  const tc = useThemeClass();
  const id = useRouter().params.id || "";
  const { data } = useHomework();
  const item = data?.items.find((it) => it.id === id) ?? null;
  const [remind, setRemind] = useState(false);
  const [edit, setEdit] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!item) loadDay().catch((e) => toast(errorText(e)));
  }, []);
  useEffect(() => {
    if (item && data) void Taro.setNavigationBarTitle({ title: `第 ${orderOf(data.items, item.id)} 项 / 共 ${data.items.length} 项` });
  }, [item?.id, data?.items.length]);

  if (!data) return <View className={"page" + tc}><View className="empty"><View className="spinner spinner--lg" /></View></View>;
  if (!item) return <View className={"page center-page" + tc}><Empty icon="document" title="这一项不在了" /></View>;

  const flat = groupBySubject(data.items).flatMap((g) => g.items);
  const run = async (fn: () => Promise<unknown>, after?: () => void) => {
    setBusy(true);
    try {
      await fn();
      after?.();
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View className={"page" + tc} style={{ paddingBottom: "calc(90px + env(safe-area-inset-bottom))" }}>
      <View className="hw-detail">
        <View className="hw-detail__top">
          <SubjectTile subject={tileSubject(item.subject)} size="xs" />
          <Text>{hwSubjectLabel(item.subject)}</Text>
          <View className="hw-detail__em">
            <Icon name="clock" size={13} color={C.secondary} stroke={2.2} />
            <Text>预计 {item.est} 分钟</Text>
          </View>
        </View>
        <Text className="hw-detail__h1">{item.title}</Text>
        {item.planAssignmentId && (
          <Text className="hw-teacher" onClick={() => void Taro.navigateTo({ url: `/pages/plan-task/index?id=${item.planAssignmentId}` })}>
            学习计划里老师布置的作业 · 做完可以直接交 ›
          </Text>
        )}
        <Text className="t-cap" style={{ color: C.brand }} onClick={() => { setTitle(item.title); setEdit(true); }}>
          修改 / 删除
        </Text>
      </View>

      {item.status === "done" ? (
        <View className="hw-detail">
          <View className="hw-donebox">
            <View className="hw-donebox__i"><Icon name="check" size={22} color="#ffffff" stroke={3} /></View>
            <View>
              <Text className="hw-donebox__b">用了 {minSec(item.used)}</Text>
              <Text className="hw-donebox__s">
                {clockOf(item.firstStartedAt)} 开始 · {clockOf(item.finishedAt)} 做完 · 预计 {item.est} 分钟
              </Text>
            </View>
          </View>
          {item.photos.length > 0 && (
            <View className="hw-photos">
              {item.photos.map((p) => (
                <Image key={p.id} className="hw-photo__img" src={p.url} mode="aspectFill" onClick={() => void Taro.previewImage({ urls: item.photos.map((x) => x.url), current: p.url })} />
              ))}
            </View>
          )}
        </View>
      ) : (
        <View className="hw-remind-card" hoverClass="card--pressed" onClick={() => item.status === "todo" && setRemind(true)}>
          <ColorIcon name="remind" size={40} />
          <View>
            <Text className="hw-rc__b">提醒时间</Text>
            <Text className="hw-rc__s">{item.chain ? "上一项做完就自动开始计时" : item.remindAt ? "到点提醒，并自动开始计时" : "还没设提醒，点这里设一个"}</Text>
          </View>
          <Text className="hw-rc__strong">{item.chain ? "接着上一项" : item.remindAt ?? "去设置"}</Text>
          <Icon name="chevron-right" size={14} color={C.tertiary} stroke={2.4} />
        </View>
      )}
      {item.status === "todo" && <Text className="t-cap c-sec" style={{ padding: "0 4px" }}>{item.used > 0 ? `之前做过 ${minSec(item.used)}，开始后接着计。` : "不想等到提醒时间，可以现在就开始。"}</Text>}

      <View className="bottom-bar">
        {item.status === "done" ? (
          <Button variant="tinted" icon="undo" className="flex1" disabled={busy} onClick={() => void run(() => act(item.id, "undo"))}>
            改回没做完
          </Button>
        ) : item.status === "todo" ? (
          <Button icon="play" className="flex1" disabled={busy} onClick={() => void run(() => act(item.id, "start"), () => void Taro.redirectTo({ url: `/pages/homework-focus/index?id=${item.id}` }))}>
            现在开始
          </Button>
        ) : (
          <Button icon="timer" className="flex1" onClick={() => void Taro.redirectTo({ url: `/pages/homework-focus/index?id=${item.id}` })}>
            回到计时
          </Button>
        )}
      </View>

      <RemindSheet item={remind ? item : null} first={flat[0]?.id === item.id} onClose={() => setRemind(false)} />
      <Sheet open={edit} onClose={() => setEdit(false)} title="修改这一项">
        <Input className="hw-edit__input" value={title} maxlength={60} adjustPosition={false} onInput={(e) => setTitle(e.detail.value)} />
        <View className="hw-chips">
          {HW_SUBJECTS.map((s) => (
            <Text key={s} className={`hw-chip${item.subject === s ? " hw-chip--on" : ""}`} onClick={() => void run(() => updateItem(item.id, { subject: s }))}>
              {hwSubjectLabel(s)}
            </Text>
          ))}
        </View>
        <Button disabled={busy || !title.trim()} onClick={() => void run(() => updateItem(item.id, { title: title.trim() }), () => setEdit(false))}>
          保存
        </Button>
        <Button variant="danger" disabled={busy} onClick={() => void run(() => deleteItem(item.id), () => void Taro.navigateBack())}>
          删除这一项
        </Button>
      </Sheet>
    </View>
  );
}
