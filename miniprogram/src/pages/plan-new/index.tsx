import { useEffect, useState } from "react";
import { Image, Input, Picker, ScrollView, Text, View } from "@tarojs/components";
import Taro, { useRouter } from "@tarojs/taro";
import { Icon } from "../../components/Icon";
import { Busy, LoginGate, ScanSheet, ShareButton, loggedIn, usePlanShare, usePlansVersion } from "../../components/plan";
import { Button, Sheet } from "../../components/ui";
import { errorText } from "../../lib/api";
import { SUBJECTS } from "../../lib/format";
import { toast } from "../../lib/hooks";
import { MAX_FILES, PLAN_SUBJECT_LABEL, attachmentDraft, fetchPlan, fileBadge, publishAssignment, scanDraft, sizeLabel, type DraftFile, type PlanInfo, type PlanSubject, type PublishRes } from "../../lib/plans";
import { C } from "../../lib/theme";

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** 默认截止时间：今晚 21:00，已经过了 20 点就明晚 */
function defaultDue(): { date: string; time: string } {
  const d = new Date();
  if (d.getHours() >= 20) d.setDate(d.getDate() + 1);
  return { date: ymd(d), time: "21:00" };
}
function dueIso(date: string, time: string): string | null {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const at = new Date(y, (m || 1) - 1, d || 1, hh || 0, mm || 0);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}
const dateLabel = (date: string) => {
  const today = ymd(new Date());
  const tomorrow = ymd(new Date(Date.now() + 86400000));
  const [, m, d] = date.split("-").map(Number);
  return date === today ? "今天" : date === tomorrow ? "明天" : `${m}月${d}日`;
};

/**
 * 新建学习计划（同时布置第一份作业），以及在已有计划里布置新作业（带 planId），是同一个页面（和 App 一致）：
 * 名称、截止时间、学科、作业内容（文件列表自己滚动，下面固定「扫描」「上传附件」两个按钮）。
 * 和 App 不同的一点：小程序里转发必须由用户亲手点一下原生的转发按钮，所以布置好以后弹出一块「转发到微信群」，点了才拉起微信的选人页。
 */
export default function PlanNew() {
  const planId = useRouter().params.planId || "";
  const [version] = usePlansVersion();
  const [plan, setPlan] = useState<PlanInfo | null>(null);
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [due, setDue] = useState(defaultDue);
  const [subject, setSubject] = useState<PlanSubject | null>(null);
  const [files, setFiles] = useState<DraftFile[]>([]);
  const [scanning, setScanning] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  const [done, setDone] = useState<PublishRes | null>(null);
  const [bottom, setBottom] = useState("");
  const logged = loggedIn();

  useEffect(() => {
    if (planId) void Taro.setNavigationBarTitle({ title: "布置新作业" });
  }, [planId]);
  useEffect(() => {
    if (planId && logged && !plan)
      fetchPlan(planId)
        .then((r) => setPlan(r.plan))
        .catch((e) => toast(errorText(e)));
  }, [planId, logged, version]);

  usePlanShare(() => (done ? { plan: done.plan, invite: done.invite, title: done.assignment.title, assignmentId: done.assignment.id } : null));

  if (!logged) return <LoginGate what="新建学习计划" />;

  const add = (more: DraftFile[]) => {
    const room = MAX_FILES - files.length;
    if (more.length > room) toast(`一份作业最多 ${MAX_FILES} 个文件`);
    const next = [...files, ...more.slice(0, Math.max(0, room))];
    setFiles(next);
    // 新加的在最下面，滚过去让人看到
    if (next.length) setTimeout(() => setBottom(`pf-${next[next.length - 1].clientId}`), 80);
  };

  const onPhotos = async (paths: string[]) => {
    setStage("正在读取照片");
    try {
      const base = files.filter((f) => f.kind === "scan").length;
      const drafts: DraftFile[] = [];
      for (let i = 0; i < paths.length; i++) drafts.push(await scanDraft(paths[i], base + i));
      add(drafts);
    } catch (e) {
      toast(errorText(e));
    } finally {
      setStage(null);
    }
  };

  /** 小程序拿不到手机里的文件，只能从微信聊天记录里选（PDF、Word 先发给「文件传输助手」或任意一个聊天） */
  const attach = async () => {
    try {
      const res = await Taro.chooseMessageFile({ count: 9, type: "all" });
      const ok: DraftFile[] = [];
      let bad = "";
      for (const f of res.tempFiles) {
        const d = attachmentDraft({ path: f.path, name: f.name, size: f.size });
        if (typeof d === "string") bad = d;
        else ok.push(d);
      }
      if (ok.length) add(ok);
      if (bad) toast(bad);
    } catch (e) {
      const msg = String((e as { errMsg?: string }).errMsg || "");
      if (!/cancel/i.test(msg)) toast("没选成，请再试一次");
    }
  };

  const submit = async () => {
    if (!planId && !name.trim()) return void toast("给学习计划起个名字");
    if (!planId && !subject) return void toast("选一个学科");
    if (!files.length) return void toast("先扫描或上传一个附件");
    try {
      const dueAt = dueIso(due.date, due.time);
      const res = await publishAssignment(planId || null, planId ? { dueAt, title: title.trim() } : { name: name.trim(), subject: subject!, dueAt, title: title.trim() }, files, setStage);
      setStage(null);
      void Taro.vibrateShort({ type: "light" }).catch(() => undefined);
      setDone(res);
    } catch (e) {
      setStage(null);
      void Taro.showModal({ title: "没布置成功", content: errorText(e), showCancel: false });
    }
  };

  const finish = () => {
    if (done) void Taro.redirectTo({ url: `/pages/plan-task/index?id=${done.assignment.id}` });
  };

  return (
    <View className="page" style={{ gap: "16px" }}>
      {planId ? (
        <>
          {plan && <Text className="t-foot c-sec pad12">布置到「{plan.name}」</Text>}
          <View className="plan-field">
            <View className="plan-field__label">
              <Text>作业名称</Text>
              <Text className="plan-field__note">不填就用日期或附件名</Text>
            </View>
            <Input className="input input--card" value={title} maxlength={120} placeholder="例如：第三单元练习" onInput={(e) => setTitle(e.detail.value)} />
          </View>
        </>
      ) : (
        <View className="plan-field">
          <View className="plan-field__label">
            <Text>计划名称</Text>
          </View>
          <Input className="input input--card" value={name} maxlength={60} placeholder="例如：五（2）班数学" onInput={(e) => setName(e.detail.value)} />
        </View>
      )}

      <View className="plan-field">
        <View className="plan-field__label">
          <Text>截止时间</Text>
        </View>
        <View className="plan-due">
          <Picker mode="date" value={due.date} start={ymd(new Date())} onChange={(e) => setDue((d) => ({ ...d, date: e.detail.value }))}>
            <View className="field">
              <Text>{dateLabel(due.date)}</Text>
              <Icon name="chevron-down" size={14} color={C.tertiary} stroke={2.4} />
            </View>
          </Picker>
          <Picker mode="time" value={due.time} onChange={(e) => setDue((d) => ({ ...d, time: e.detail.value }))}>
            <View className="field">
              <Text>{due.time}</Text>
              <Icon name="chevron-down" size={14} color={C.tertiary} stroke={2.4} />
            </View>
          </Picker>
        </View>
      </View>

      {!planId && (
        <View className="plan-field">
          <View className="plan-field__label">
            <Text>学科</Text>
          </View>
          <ScrollView scrollX className="hscroll" enhanced showScrollbar={false}>
            {([...SUBJECTS, "mixed"] as PlanSubject[]).map((s) => (
              <View key={s} className={`chip chip--card${subject === s ? " chip--on" : ""}`} onClick={() => setSubject(s)}>
                {PLAN_SUBJECT_LABEL[s]}
              </View>
            ))}
          </ScrollView>
        </View>
      )}

      <View className="plan-field">
        <View className="plan-field__label">
          <Text>作业内容</Text>
          <Text className="plan-field__note">{files.length ? `已添加 ${files.length} 个` : "扫描件会识别成题目，自动批改"}</Text>
        </View>
        <ScrollView scrollY className="plan-files" enhanced showScrollbar={false} scrollIntoView={bottom} scrollWithAnimation>
          {files.length === 0 && <Text className="plan-empty">{"还没有内容。\n点下面的「扫描」拍下作业，或「上传附件」从微信聊天里选 PDF、Word、图片。"}</Text>}
          {files.map((f) => (
            <View key={f.clientId} id={`pf-${f.clientId}`} className="plan-file">
              {f.kind === "scan" ? (
                <Image className="plan-file__icon" src={f.path} mode="aspectFill" />
              ) : (
                <View className="plan-file__icon">
                  <Text>{fileBadge(f.mime)}</Text>
                </View>
              )}
              <View className="flex1 col gap2 minw0">
                <Text className="t-body ellipsis" style={{ fontWeight: 500 }}>
                  {f.name}
                </Text>
                <Text className="t-cap c-sec">
                  {f.kind === "scan" ? "扫描件" : "附件"} · {sizeLabel(f.size)}
                </Text>
              </View>
              <View className="plan-file__x" onClick={() => setFiles((cur) => cur.filter((x) => x.clientId !== f.clientId))}>
                <Icon name="xmark" size={16} color={C.tertiary} stroke={2.4} />
              </View>
            </View>
          ))}
        </ScrollView>
        <View className="plan-add">
          <Button variant="outline" icon="camera" onClick={() => setScanning(true)}>
            扫描
          </Button>
          <Button variant="outline" icon="document" onClick={() => void attach()}>
            上传附件
          </Button>
        </View>
      </View>

      <View className="bottom-bar">
        <Button icon="export" className="flex1" disabled={Boolean(stage) || Boolean(done)} onClick={() => void submit()}>
          确定，转发到微信
        </Button>
      </View>

      <ScanSheet open={scanning} onClose={() => setScanning(false)} onPhotos={(p) => void onPhotos(p)} />
      <Sheet open={Boolean(done)} onClose={finish} title="已布置">
        <Text className="t-sub c-sec">点下面的按钮，选一个微信群或同学。同学点开卡片就自动加入「{done?.plan.name}」，直接看到这份作业。</Text>
        <ShareButton>转发到微信</ShareButton>
        <Button variant="plain" onClick={finish}>
          看作业情况
        </Button>
      </Sheet>
      {stage && <Busy text={stage} />}
    </View>
  );
}
