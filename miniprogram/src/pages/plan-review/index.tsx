import { useEffect, useState } from "react";
import { Image, Input, ScrollView, Swiper, SwiperItem, Text, View } from "@tarojs/components";
import Taro, { useRouter } from "@tarojs/taro";
import { Icon } from "../../components/Icon";
import { LoginGate, PageState, QuestionGrid, ScoreStats, loggedIn, usePlansVersion } from "../../components/plan";
import { Button, MathText, Sheet, Tag } from "../../components/ui";
import { errorText } from "../../lib/api";
import { formatDateTime } from "../../lib/format";
import { toast } from "../../lib/hooks";
import { AI_GRADING, MARK_REVIEWED, RETURN_REDO, absoluteUrl, bumpPlans, fetchSubmission, fileBadge, memberName, openPlanFile, reviewSubmission, sizeLabel, type PlanFileView, type SubmissionRes } from "../../lib/plans";
import { useShare } from "../../lib/share";
import { C, useThemeClass } from "../../lib/theme";
import type { Mark } from "../../lib/types";

const MARK_OPTIONS: { value: Mark; label: string }[] = [
  { value: "correct", label: "对" },
  { value: "wrong", label: "错" },
  { value: "partial", label: "半对" },
  { value: "blank", label: "没做" },
];

/** 文件名一排里显示的名字：去掉扩展名；没有名字的按「第 n 张」 */
const fileLabel = (f: PlanFileView, i: number) => f.name.replace(/\.[a-z0-9]{2,5}$/i, "").trim() || `第 ${i + 1} 张`;

/**
 * 创建人看一个学生交的作业（和 App 一致）：先是作业名，下面是交上来的文件，文件名排成一排，左右滑着换，点图片放大。
 * 「已阅」和「退回重做」两个开关都关着时这一页只是看，没有留言框和底部按钮；开了批改还有逐题结果（点题号可以改判）。
 * 交的人不止一个时右上有上一位 / 下一位。这一页有同学的名字和作业，转发出去的只是首页。
 */
export default function PlanReview() {
  const tc = useThemeClass();
  useShare();
  const id = useRouter().params.id || "";
  const [version] = usePlansVersion();
  const [data, setData] = useState<SubmissionRes | null>(null);
  const [error, setError] = useState("");
  const [picked, setPicked] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [cur, setCur] = useState(0);
  const logged = loggedIn();

  useEffect(() => {
    if (!logged || data) return;
    fetchSubmission(id)
      .then((r) => {
        setData(r);
        setComment(r.submission.comment);
        void Taro.setNavigationBarTitle({ title: r.student ? memberName(r.student) : "我交的作业" });
      })
      .catch((e) => setError(errorText(e) || "打不开"));
  }, [id, logged, version]);

  if (!logged) return <LoginGate />;
  if (error) return <PageState error={error} />;
  if (!data) return <PageState />;

  const { submission: sub, nav: pager, assignment, plan } = data;
  const owner = plan.role === "owner";
  const results = AI_GRADING ? sub.results ?? null : null; // 批改关着：只看文件
  const bar = owner && (MARK_REVIEWED || RETURN_REDO); // 两个开关都关着：没有可做的动作，留言框和底部按钮都不出
  const files = sub.files.filter((f) => f.url);
  const at = Math.min(cur, Math.max(0, files.length - 1));
  const q = picked !== null && results ? results[picked] : null;
  const open = (sid: string) => Taro.redirectTo({ url: `/pages/plan-review/index?id=${sid}` });
  const back = () => {
    if (Taro.getCurrentPages().length > 1) void Taro.navigateBack();
    else if (owner) void Taro.redirectTo({ url: `/pages/plan/index?id=${plan.id}` });
    else if (assignment) void Taro.redirectTo({ url: `/pages/plan-task/index?id=${assignment.id}` });
  };

  const remark = async (mark: Mark) => {
    if (picked === null) return;
    try {
      const res = await reviewSubmission(sub.id, { marks: { [picked]: mark } });
      setData({ ...data, submission: res.submission });
      setPicked(null);
    } catch (e) {
      toast(errorText(e));
    }
  };
  const finish = async (status: "reviewed" | "returned") => {
    if (status === "returned" && !comment.trim()) return void toast("先写一句哪里要重做");
    setBusy(true);
    try {
      await reviewSubmission(sub.id, { status, comment: comment.trim() });
      bumpPlans();
      toast(status === "reviewed" ? "已阅" : "已退回", "success");
      if (status === "reviewed" && pager?.next) void open(pager.next);
      else back();
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View className={"page" + tc} style={bar ? undefined : { paddingBottom: "calc(16px + env(safe-area-inset-bottom))" }}>
      {/* 先看到作业名，下面是交上来的文件：文件名一排，左右滑着换 */}
      <View className="plan-head">
        <View className="flex1 col minw0">
          <Text className="t-headline ellipsis">{assignment?.title ?? "作业"}</Text>
          <View className="row-center gap6">
            <Text className="t-foot c-sec">
              {formatDateTime(sub.submittedAt)} 交{pager && pager.total > 1 ? ` · 第 ${pager.index}/${pager.total} 位` : ""}
            </Text>
            {sub.late && (
              <Tag kind="neutral" icon={null}>
                迟交
              </Tag>
            )}
            {MARK_REVIEWED || (RETURN_REDO && sub.status === "returned") ? (
              <Tag kind={sub.status === "reviewed" ? "correct" : sub.status === "returned" ? "wrong" : "info"} icon={sub.status === "reviewed" ? undefined : null}>
                {sub.status === "reviewed" ? "已阅" : sub.status === "returned" ? "已退回" : "待阅"}
              </Tag>
            ) : null}
          </View>
        </View>
        {pager && pager.total > 1 && (
          <>
            <View className="icon-btn" style={{ opacity: pager.prev ? 1 : 0.3 }} onClick={() => pager.prev && void open(pager.prev)}>
              <Icon name="chevron-up" size={20} color={C.brand} stroke={2.2} />
            </View>
            <View className="icon-btn" style={{ opacity: pager.next ? 1 : 0.3 }} onClick={() => pager.next && void open(pager.next)}>
              <Icon name="chevron-down" size={20} color={C.brand} stroke={2.2} />
            </View>
          </>
        )}
      </View>

      {AI_GRADING && (
        <View className="card" style={{ gap: "12px" }}>
          {owner && results && sub.score && (
            <View className="row-center gap4">
              <Icon name="pencil" size={13} color={C.tertiary} stroke={2.4} />
              <Text className="t-cap c-sec">点题号可改判</Text>
            </View>
          )}
          {results && sub.score ? (
            <>
              <ScoreStats score={sub.score} />
              <QuestionGrid results={results} onPick={setPicked} />
            </>
          ) : (
            <View className="row-center gap8">
              <View className="spinner" />
              <Text className="t-sub c-sec">正在批改…</Text>
            </View>
          )}
        </View>
      )}

      {files.length === 0 ? (
        <Text className="plan-empty">文件还在上传，稍后再来看</Text>
      ) : (
        <>
          <ScrollView scrollX enhanced showScrollbar={false} scrollWithAnimation scrollIntoView={`pf-${Math.max(0, at - 1)}`} className="hscroll">
            {files.map((f, i) => (
              <View key={f.id} id={`pf-${i}`} className={`chip chip--card${i === at ? " chip--on" : ""}`} onClick={() => setCur(i)}>
                {fileLabel(f, i)}
              </View>
            ))}
          </ScrollView>
          <View className={`plan-swipe${bar ? " plan-swipe--bar" : ""}`}>
            <Swiper className="plan-swipe__swiper" current={at} duration={260} onChange={(e) => setCur(e.detail.current)}>
              {files.map((f) => (
                <SwiperItem key={f.id}>
                  {f.mime.startsWith("image/") ? (
                    <Image className="plan-swipe__img" src={absoluteUrl(f.url!)} mode="aspectFit" lazyLoad onClick={() => void openPlanFile(f, files)} />
                  ) : (
                    <View className="plan-swipe__doc" onClick={() => void openPlanFile(f, files)}>
                      <View className="plan-file__icon">{fileBadge(f.mime)}</View>
                      <Text className="t-body ellipsis">{f.name}</Text>
                      <Text className="t-foot c-sec">{sizeLabel(f.size)} · 点一下打开</Text>
                    </View>
                  )}
                </SwiperItem>
              ))}
            </Swiper>
            {files.length > 1 && (
              <Text className="plan-swipe__count">
                {at + 1}/{files.length}
              </Text>
            )}
          </View>
        </>
      )}

      {bar && (
        <>
          <Input className="input input--card" value={comment} maxlength={200} placeholder={RETURN_REDO ? "给同学留句话（退回时必填）" : "给同学留句话"} cursorSpacing={90} onInput={(e) => setComment(e.detail.value)} />
          <View className="bottom-bar">
            {RETURN_REDO && (
              <Button variant="outline" icon="refresh" disabled={busy} onClick={() => void finish("returned")}>
                退回
              </Button>
            )}
            {MARK_REVIEWED && (
              <Button icon="check" className="flex1" disabled={busy} onClick={() => void finish("reviewed")}>
                {pager?.next ? "已阅，下一份" : "已阅"}
              </Button>
            )}
          </View>
        </>
      )}

      <Sheet open={Boolean(q)} onClose={() => setPicked(null)} title={q ? `第 ${q.n} 题` : ""}>
        {q && (
          <>
            {q.t && <MathText className="t-body" text={q.t} />}
            <View className="group group--fill">
              <View className="list-row">
                <View className="flex1 col gap2 minw0">
                  <Text className="row__sub">作答</Text>
                  {q.s ? <MathText className="t-body" text={q.s} /> : <Text className="t-body c-sec">（没写）</Text>}
                </View>
              </View>
              <View className="list-row">
                <View className="flex1 col gap2 minw0">
                  <Text className="row__sub">答案</Text>
                  {q.a ? <MathText className="t-body" text={q.a} /> : <Text className="t-body c-sec">（没识别出）</Text>}
                </View>
              </View>
            </View>
            {owner && (
              <View className="plan-marks">
                {MARK_OPTIONS.map((o) => (
                  <View key={o.value} className={`chip${q.m === o.value ? " chip--on" : ""}`} onClick={() => void remark(o.value)}>
                    {o.label}
                  </View>
                ))}
              </View>
            )}
          </>
        )}
      </Sheet>
    </View>
  );
}
