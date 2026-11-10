import { useEffect, useState } from "react";
import { Image, Input, Text, View } from "@tarojs/components";
import Taro, { useRouter } from "@tarojs/taro";
import { Icon } from "../../components/Icon";
import { LoginGate, PageState, QuestionGrid, ScoreStats, loggedIn, usePlansVersion } from "../../components/plan";
import { Button, MathText, Sheet, Tag } from "../../components/ui";
import { errorText } from "../../lib/api";
import { formatDateTime } from "../../lib/format";
import { toast } from "../../lib/hooks";
import { absoluteUrl, bumpPlans, fetchSubmission, memberName, reviewSubmission, type SubmissionRes } from "../../lib/plans";
import { useShare } from "../../lib/share";
import { C } from "../../lib/theme";
import type { Mark } from "../../lib/types";

const MARK_OPTIONS: { value: Mark; label: string }[] = [
  { value: "correct", label: "对" },
  { value: "wrong", label: "错" },
  { value: "partial", label: "半对" },
  { value: "blank", label: "没做" },
];

/**
 * 创建人检查一个学生交的作业（和 App 一致）：原照片、逐题结果（点题号可以改判）、写一句话，已阅或退回重做。
 * 带上一个 / 下一个，连着批不用来回进出。这一页有同学的名字和作业，转发出去的只是首页。
 */
export default function PlanReview() {
  useShare();
  const id = useRouter().params.id || "";
  const [version] = usePlansVersion();
  const [data, setData] = useState<SubmissionRes | null>(null);
  const [error, setError] = useState("");
  const [picked, setPicked] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
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
  const results = sub.results ?? null;
  const q = picked !== null && results ? results[picked] : null;
  const photos = sub.files.filter((f) => f.url).map((f) => absoluteUrl(f.url!));
  const open = (sid: string) => Taro.redirectTo({ url: `/pages/plan-review/index?id=${sid}` });
  const back = () => {
    if (Taro.getCurrentPages().length > 1) void Taro.navigateBack();
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
    <View className="page">
      <View className="plan-head">
        <View className="flex1 col minw0">
          <Text className="t-headline ellipsis">{assignment?.title ?? "作业"}</Text>
          <Text className="t-foot c-sec">
            {formatDateTime(sub.submittedAt)}
            {pager ? ` · ${pager.index}/${pager.total}` : ""}
          </Text>
        </View>
        {pager && (
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

      <View className="card" style={{ gap: "12px" }}>
        <View className="row-center gap8">
          {owner && results && sub.score ? (
            <View className="flex1 row-center gap4">
              <Icon name="pencil" size={13} color={C.tertiary} stroke={2.4} />
              <Text className="t-cap c-sec">点题号可改判</Text>
            </View>
          ) : (
            <View className="flex1" />
          )}
          {sub.late && (
            <Tag kind="neutral" icon={null}>
              迟交
            </Tag>
          )}
          <Tag kind={sub.status === "reviewed" ? "correct" : sub.status === "returned" ? "wrong" : "info"} icon={sub.status === "reviewed" ? undefined : null}>
            {sub.status === "reviewed" ? "已阅" : sub.status === "returned" ? "已退回" : "待阅"}
          </Tag>
        </View>
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

      {photos.map((src) => (
        <Image key={src} className="plan-photo" src={src} mode="widthFix" lazyLoad onClick={() => Taro.previewImage({ current: src, urls: photos })} />
      ))}

      {owner && (
        <>
          <Input className="input input--card" value={comment} maxlength={200} placeholder="给同学留句话（退回时必填）" cursorSpacing={90} onInput={(e) => setComment(e.detail.value)} />
          <View className="bottom-bar">
            <Button variant="outline" icon="refresh" disabled={busy} onClick={() => void finish("returned")}>
              退回
            </Button>
            <Button icon="check" className="flex1" disabled={busy} onClick={() => void finish("reviewed")}>
              {pager?.next ? "已阅，下一份" : "已阅"}
            </Button>
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
