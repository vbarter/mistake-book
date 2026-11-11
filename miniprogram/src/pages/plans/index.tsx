import { useEffect, useState } from "react";
import { Text, View } from "@tarojs/components";
import Taro, { usePullDownRefresh } from "@tarojs/taro";
import { Icon } from "../../components/Icon";
import { Count, LoginGate, loggedIn, usePlansVersion } from "../../components/plan";
import { Avatar, Button, Empty, Tag } from "../../components/ui";
import { errorText } from "../../lib/api";
import { toast } from "../../lib/hooks";
import { PLAN_SUBJECT_LABEL, fetchPlans, type PlanInfo } from "../../lib/plans";
import { useShare } from "../../lib/share";
import { C } from "../../lib/theme";

/** 学习计划列表（和 App 一致）：我创建的、我加入的。加入只能靠点微信里的卡片，这里只有「新建」一个入口。 */
export default function Plans() {
  useShare();
  const [version] = usePlansVersion();
  const [plans, setPlans] = useState<PlanInfo[] | null>(null);
  const logged = loggedIn();

  const load = async () => {
    if (!loggedIn()) return;
    try {
      setPlans((await fetchPlans()).plans);
    } catch (e) {
      setPlans((p) => p ?? []);
      toast(errorText(e));
    }
  };
  useEffect(() => {
    void load();
  }, [version]);
  usePullDownRefresh(async () => {
    await load();
    Taro.stopPullDownRefresh();
  });

  if (!logged) return <LoginGate />;

  const owned = plans?.filter((p) => p.role === "owner") ?? [];
  const joined = plans?.filter((p) => p.role === "member") ?? [];
  const card = (p: PlanInfo) => (
    <View key={p.id} className="card card--row" hoverClass="card--pressed" onClick={() => Taro.navigateTo({ url: `/pages/plan/index?id=${p.id}` })}>
      {/* 左边是创建人的头像（我创建的就是自己的），学科写在第二行 */}
      <Avatar name={p.teacher} url={p.teacherAvatar} size={52} />
      <View className="flex1 col gap2 minw0">
        <Text className="t-headline ellipsis">{p.name}</Text>
        <View className="plan-counts" style={{ gap: "10px" }}>
          <Text className="t-foot c-sec ellipsis">
            {p.role === "member" ? `${p.teacher} · ` : ""}
            {PLAN_SUBJECT_LABEL[p.subject] ?? "综合"}
          </Text>
          {p.role === "owner" && (
            <Count icon="family" color={C.tertiary}>
              {p.members ?? 0}
            </Count>
          )}
          <Count icon="document" color={C.tertiary}>
            {p.assignments ?? 0}
          </Count>
        </View>
      </View>
      {p.role === "owner" && (p.toReview ?? 0) > 0 && (
        <Tag kind="info" icon="pencil">
          {p.toReview}
        </Tag>
      )}
      {p.role === "member" && (p.todo ?? 0) > 0 && (
        <Tag kind="pending" icon="clock">
          {p.todo}
        </Tag>
      )}
      <Icon name="chevron-right" size={14} color={C.tertiary} stroke={2.4} />
    </View>
  );

  return (
    <View className="page" style={{ gap: "10px" }}>
      {!plans && (
        <View className="empty">
          <View className="spinner spinner--lg" />
        </View>
      )}
      {plans && plans.length === 0 && <Empty icon="graduation" title="还没有学习计划" text="新建一个，或点开老师发的卡片加入" />}
      {owned.length > 0 && (
        <View className="plan-field__label" style={{ paddingTop: "4px" }}>
          <Text>我创建的</Text>
        </View>
      )}
      {owned.map(card)}
      {joined.length > 0 && (
        <View className="plan-field__label" style={{ paddingTop: "8px" }}>
          <Text>我加入的</Text>
        </View>
      )}
      {joined.map(card)}
      <View className="bottom-bar">
        <Button icon="plus" className="flex1" onClick={() => Taro.navigateTo({ url: "/pages/plan-new/index" })}>
          新建学习计划
        </Button>
      </View>
    </View>
  );
}
