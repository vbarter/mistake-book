/** 学习计划各页面共用的小组件（和 App 的 pages/plans/shared.tsx 对应）：学科方块、扫描面板、起名字、题号格子、转发按钮、登录提示 */
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import Taro, { useDidShow, useShareAppMessage } from "@tarojs/taro";
import { Button as NativeButton, Input, Text, View } from "@tarojs/components";
import { Icon, WechatIcon, type IconName } from "./Icon";
import { Avatar, Button, Empty, Sheet, SubjectTile } from "./ui";
import { errorText } from "../lib/api";
import { currentUser, ensureLogin, isLoggedIn, updateProfile } from "../lib/auth";
import { pickPhotos, type Source } from "../lib/capture";
import { toast } from "../lib/hooks";
import { DEFAULT_NICKNAME, PLANS_EVENT, teacherLine, createdLabel, sharePayload, startPlanSync, type PlanInfo, type PlanSubject, type ResultRow, type ShareInfo } from "../lib/plans";
import { SHARE_TITLE } from "../lib/share";
import { C } from "../lib/theme";

/** 图标 + 数字的一小格：人数、份数、对 / 错 / 没做都用它，代替「已交 3」这类文字 */
export function Count({ icon, color = C.secondary, children }: { icon: IconName; color?: string; children: ReactNode }) {
  return (
    <View className="plan-count">
      <Icon name={icon} size={14} color={color} stroke={2.4} />
      <Text className="num" style={{ color }}>
        {children}
      </Text>
    </View>
  );
}

type Score = { correct: number; wrong: number; blank: number };

/** 一行里的对 / 错 / 没做：绿勾、红叉、灰横线各带一个数字 */
export function ScoreCounts({ score }: { score: Score }) {
  return (
    <View className="plan-counts">
      <Count icon="checkcircle" color={C.ok}>
        {score.correct}
      </Count>
      <Count icon="xcircle" color={C.wrong}>
        {score.wrong}
      </Count>
      <Count icon="minus" color={C.tertiary}>
        {score.blank}
      </Count>
    </View>
  );
}

/** 对 / 错 / 没做三个色块：图标 + 大数字，不写字 */
export function ScoreStats({ score }: { score: Score }) {
  const cell = (kind: string, icon: IconName, color: string, n: number) => (
    <View className={`stat stat--${kind} stat--icon`}>
      <Icon name={icon} size={20} color={color} stroke={2.4} />
      <Text className="stat__value num" style={{ color }}>
        {n}
      </Text>
    </View>
  );
  return (
    <View className="stats">
      {cell("ok", "checkcircle", C.ok, score.correct)}
      {cell("wrong", "xcircle", C.wrong, score.wrong)}
      {cell("mute", "minus", C.secondary, score.blank)}
    </View>
  );
}

/** 学科方块：综合用中性色 */
export function PlanTile({ subject, size = "md" }: { subject: PlanSubject | null | undefined; size?: "lg" | "md" | "sm" | "xs" }) {
  return <SubjectTile subject={subject && subject !== "mixed" ? subject : null} size={size} />;
}

/**
 * 成员看到的「这是谁的哪个学习计划」：创建人头像、计划名、创建人称呼 · 学科、创建时间。
 * 作业页上用它，点一下去学习计划页看全部作业（more 是右边那句话）。
 */
export function PlanCreator({ plan, more, onClick }: { plan: PlanInfo; more?: string; onClick?: () => void }) {
  return (
    <View className="card plan-creator" hoverClass={onClick ? "card--pressed" : "none"} onClick={onClick}>
      <Avatar name={plan.teacher} url={plan.teacherAvatar} size={44} />
      <View className="flex1 col gap2 minw0">
        <Text className="t-headline ellipsis">{plan.name}</Text>
        <Text className="t-foot c-sec ellipsis">
          {teacherLine(plan.teacher, plan.subject)}
        </Text>
        <Text className="t-foot c-sec">{createdLabel(plan.createdAt)}</Text>
      </View>
      {onClick && (
        <View className="row-center gap2">
          {more && <Text className="t-foot c-sec">{more}</Text>}
          <Icon name="chevron-right" size={14} color={C.tertiary} stroke={2.4} />
        </View>
      )}
    </View>
  );
}

/** 回到页面、登录状态变了、学习计划的数据有变化时 +1，页面据此重新拉 */
export function usePlansVersion(): [number, () => void] {
  const [v, setV] = useState(0);
  const bump = () => setV((x) => x + 1);
  useDidShow(bump);
  useEffect(() => {
    if (isLoggedIn()) startPlanSync(); // 刚登录完也接着回填（已经在跑就什么都不做）
  }, [v]);
  useEffect(() => {
    Taro.eventCenter.on(PLANS_EVENT, bump);
    Taro.eventCenter.on("auth", bump);
    return () => {
      Taro.eventCenter.off(PLANS_EVENT, bump);
      Taro.eventCenter.off("auth", bump);
    };
  }, []);
  return [v, bump];
}

/** 学习计划都在服务器上，没登录时整页换成这一块 */
export function LoginGate({ what = "使用学习计划", text = "" }: { what?: string; text?: string }) {
  return (
    <View className="page center-page">
      <Empty icon="graduation" title="登录后使用学习计划" text={text || undefined}>
        <Button size="sm" onClick={() => void ensureLogin(what)} style={{ width: "auto", padding: "0 24px" }}>
          微信登录
        </Button>
      </Empty>
    </View>
  );
}
export const loggedIn = () => isLoggedIn();

/** 整页的加载 / 打不开 */
export function PageState({ error, action }: { error?: string; action?: ReactNode }) {
  return (
    <View className="page center-page">
      {error ? (
        <Empty icon="warning" title={error}>
          {action}
        </Empty>
      ) : (
        <View className="spinner spinner--lg" />
      )}
    </View>
  );
}

export function Busy({ text }: { text: string }) {
  return (
    <View className="hud" catchMove>
      <View className="hud__card">
        <View className="spinner spinner--lg" />
        <Text className="t-sub">{text}</Text>
      </View>
    </View>
  );
}

/** 扫描：拍照（连着拍，逐张确认）或从相册选，返回照片的本机路径 */
export function ScanSheet({ open, title = "扫描", onClose, onPhotos }: { open: boolean; title?: string; onClose: () => void; onPhotos: (paths: string[]) => void }) {
  const pick = async (source: Source) => {
    onClose();
    try {
      const paths = await pickPhotos(source);
      if (paths.length) onPhotos(paths);
    } catch (e) {
      const msg = String((e as { errMsg?: string }).errMsg || (e as Error).message || "");
      if (!/cancel/i.test(msg)) void Taro.showModal({ title: "没选成", content: errorText(e), showCancel: false });
    }
  };
  const tile = (icon: IconName, name: string, source: Source) => (
    <View className="add-tile" hoverClass="card--pressed" onClick={() => void pick(source)}>
      <View className="add-tile__icon">
        <Icon name={icon} size={28} color="#ffffff" stroke={2} />
      </View>
      <Text className="t-headline">{name}</Text>
    </View>
  );
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <View className="add-grid">
        {tile("camera", "拍照", "camera")}
        {tile("photo", "相册", "album")}
      </View>
    </Sheet>
  );
}

/**
 * 起名字 / 改名字。改的是账号的称呼，所有学习计划里老师看到的名字跟着变。
 * required：刚注册的新用户加入计划前必须先起名字，不能关掉。
 */
export function NameSheet({ open, required, onClose, onDone }: { open: boolean; required?: boolean; onClose: () => void; onDone: (name: string) => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    const nick = currentUser()?.nickname ?? "";
    setName(nick && nick !== DEFAULT_NICKNAME ? nick : "");
  }, [open]);
  const save = async () => {
    const value = name.trim().slice(0, 16);
    if (!value) return void toast("写上你的名字，老师才知道是谁交的作业");
    setBusy(true);
    try {
      await updateProfile({ nickname: value });
      onDone(value);
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={open} onClose={required ? () => undefined : onClose} title={required ? "你的名字" : "改名字"}>
      <Text className="t-foot c-sec">写真实姓名，老师才认得出你</Text>
      <Input className="input" value={name} maxlength={16} placeholder="你的名字" focus adjustPosition={false} confirmType="done" onInput={(e) => setName(e.detail.value)} onConfirm={() => void save()} />
      <Button onClick={() => void save()} disabled={busy || !name.trim()}>
        {required ? "加入" : "保存"}
      </Button>
    </Sheet>
  );
}

/** 逐题结果：一格一题，绿 = 对，红 = 错 / 半对，橙 = 没做；右上角有小点的是老师改判过的 */
export function QuestionGrid({ results, onPick }: { results: ResultRow[]; onPick?: (i: number) => void }) {
  return (
    <View className="plan-grid">
      {results.map((r, i) => (
        <View key={i} className={`plan-q plan-q--${r.m}`} hoverClass={onPick ? "plan-q--hover" : "none"} onClick={() => onPick?.(i)}>
          <Text>{r.n}</Text>
          {r.o && <View className="plan-q__dot" />}
        </View>
      ))}
    </View>
  );
}

/**
 * 转发按钮：小程序里只有用户亲手点原生的 <button open-type="share"> 才能拉起转发，
 * 所以所有「转发到微信」都是这个按钮；卡片的内容由页面的 useShareAppMessage 决定（remind = 提醒没交的同学，assignmentId = 一页有多份作业时转发哪一份）。
 */
export function ShareButton({ children, variant = "primary", pill, icon, remind, assignmentId, style, onTap }: { children: ReactNode; variant?: "primary" | "outline" | "tinted"; pill?: boolean; icon?: IconName; remind?: boolean; assignmentId?: string; style?: CSSProperties; onTap?: () => void }) {
  const cls = pill ? "plan-pill btn-native" : ["btn", "btn-native", variant !== "primary" && `btn--${variant}`].filter(Boolean).join(" ");
  const light = pill || variant !== "primary";
  return (
    <NativeButton className={cls} hoverClass={pill ? "none" : "btn--hover"} openType="share" data-remind={remind ? "1" : ""} data-aid={assignmentId ?? ""} style={style} onClick={onTap}>
      {/* 没指定图标就是微信图标：让人一眼知道是发到微信 */}
      {icon ? <Icon name={icon} size={pill ? 15 : 20} color={light ? C.brand : "#ffffff"} stroke={2.2} /> : <WechatIcon size={pill ? 18 : 22} color={light ? "#07c160" : "#ffffff"} />}
      <Text>{children}</Text>
    </NativeButton>
  );
}

/** 列表里的一行文字菜单（面板里用） */
export function MenuRow({ title, sub, danger, onClick }: { title: string; sub?: string; danger?: boolean; onClick: () => void }) {
  return (
    <View className="list-row" hoverClass="list-row--hover" onClick={onClick}>
      <View className="flex1 col gap2 minw0">
        <Text className={`row__title${danger ? " c-wrong" : ""}`}>{title}</Text>
        {sub && <Text className="row__sub">{sub}</Text>}
      </View>
    </View>
  );
}

/** 二次确认（用微信自带的对话框） */
export async function confirm(title: string, content: string, action: string, danger = false): Promise<boolean> {
  const m = await Taro.showModal({ title, content, confirmText: action, confirmColor: danger ? C.wrong : C.brand });
  return m.confirm;
}

/**
 * 页面的转发内容：get 返回要转发的学习计划（创建人才有邀请码）就发加入卡片，返回 null 就和别的页面一样落到首页。
 * 成员手里没有邀请码，转发出去的永远是首页，不会把计划带出去。
 */
export function usePlanShare(get: (remind: boolean, assignmentId?: string) => ShareInfo | null) {
  useShareAppMessage((res) => {
    const dataset = res.from === "button" ? (res.target as { dataset?: { remind?: string; aid?: string } } | undefined)?.dataset : undefined;
    const remind = Boolean(dataset?.remind);
    const info = get(remind, dataset?.aid || undefined);
    return info ? sharePayload({ ...info, remind: remind || info.remind }) : { title: SHARE_TITLE, path: "/pages/home/index" };
  });
}
