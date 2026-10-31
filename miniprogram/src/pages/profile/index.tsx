import { useEffect, useMemo } from "react";
import { Text, View } from "@tarojs/components";
import Taro from "@tarojs/taro";
import { Icon } from "../../components/Icon";
import { Row, SubjectTile } from "../../components/ui";
import { errorText } from "../../lib/api";
import { currentUser, loginLabel, refreshUser, updateProfile } from "../../lib/auth";
import { allErrors } from "../../lib/errors";
import { GRADE_LABEL } from "../../lib/format";
import { toast, useDataVersion } from "../../lib/hooks";
import { listFolders, photosSizeMB } from "../../lib/store";

/** 小程序版本：三位 */
const VERSION = "1.8.2";

/** 我的：和 App 的「我的」同一套布局——账号卡片、统计、学习设置、数据与隐私、关于 */
export default function Profile() {
  const [version, refresh] = useDataVersion();
  const user = useMemo(() => currentUser(), [version]);
  const folders = useMemo(() => listFolders(), [version]);
  const city = useMemo(() => (Taro.getStorageSync("zcb.city") as string) || "", [version]);

  useEffect(() => {
    void refreshUser().then(() => refresh());
  }, []);

  const stats = useMemo(() => {
    const errors = allErrors(folders);
    return {
      papers: folders.reduce((n, f) => n + f.papers.length, 0),
      wrong: errors.filter((e) => e.kind !== "未作答").length,
      blank: errors.filter((e) => e.kind === "未作答").length,
      mb: photosSizeMB(folders),
    };
  }, [folders]);

  if (!user) return null;
  const grade = GRADE_LABEL[user.grade] ?? `${user.grade} 年级`;
  const g = Number(user.grade);
  const gradeShort = g >= 10 ? grade : g >= 7 ? `初${"一二三"[g - 7]}` : grade.replace("年级", "");
  const guest = user.loginMethod === "guest";
  const go = (url: string) => Taro.navigateTo({ url });

  const editName = async () => {
    const m = await Taro.showModal({ title: "怎么称呼你", editable: true, content: user.nickname });
    if (!m.confirm || !m.content?.trim()) return;
    try {
      await updateProfile({ nickname: m.content.trim().slice(0, 16) });
      refresh();
      toast("已更新", "success");
    } catch (e) {
      toast(errorText(e));
    }
  };

  return (
    <View className="page page--tab">
      <View className="card card--row profile-card" hoverClass="card--pressed" onClick={editName}>
        <View className="avatar-wrap">
          <View className="avatar">{user.nickname.slice(-1)}</View>
          <Text className="avatar__badge">{gradeShort}</Text>
        </View>
        <View className="flex1 col gap4 minw0">
          <Text className="t-title3 b ellipsis">{user.nickname}</Text>
          <View className="row-center gap4">
            <Icon name="pin" size={13} color="#5b5b63" stroke={2.2} />
            <Text className="t-foot c-sec">{[city, grade].filter(Boolean).join(" · ")}</Text>
          </View>
          <View className="row-center gap4">
            <Icon name={guest ? "info" : "checkcircle"} size={12} color={guest ? "#5b5b63" : "#1e7a47"} stroke={2.6} />
            <Text className={`t-cap ${guest ? "c-sec" : "c-ok"}`}>{guest ? "游客账号" : `${loginLabel(user.loginMethod)}账号已登录`}</Text>
          </View>
        </View>
        <Icon name="chevron-right" size={16} color="#8e8e93" stroke={2.4} />
      </View>

      <View className="stats stats--3">
        <View className="stat">
          <Text className="stat__value c-brand">{stats.papers}</Text>
          <Text className="stat__label">张试卷</Text>
        </View>
        <View className="stat">
          <Text className="stat__value c-wrong">{stats.wrong}</Text>
          <Text className="stat__label">道答错</Text>
        </View>
        <View className="stat">
          <Text className="stat__value c-accent">{stats.blank}</Text>
          <Text className="stat__label">道未作答</Text>
        </View>
      </View>

      <View className="col">
        <Text className="group-title">学习设置</Text>
        <View className="group">
          <Row icon="graduation" iconBg="#2f6fed" title="年级与城市" value={[grade, city].filter(Boolean).join(" · ")} onClick={() => go("/pages/settings/index")} />
          <Row
            icon="letters"
            iconBg="#5b37a8"
            title="学科"
            value={
              // 最多露 3 个学科图标，其余用「+N」收起
              <View className="row-center gap4">
                {user.subjects.slice(0, 3).map((s) => (
                  <SubjectTile key={s} subject={s} size="xs" />
                ))}
                {user.subjects.length > 3 && <Text className="t-foot c-sec">+{user.subjects.length - 3}</Text>}
                {user.subjects.length === 0 && <Text className="t-foot c-sec">未选</Text>}
              </View>
            }
            onClick={() => go("/pages/settings/index")}
          />
        </View>
        <Text className="group-note">年级和城市决定错题按哪套考纲归类知识点；试卷上能看出来的以试卷为准。</Text>
      </View>

      <View className="col">
        <Text className="group-title">数据与隐私</Text>
        <View className="group">
          <Row icon="photo" iconBg="#b35300" title="本机试卷照片" value={`${stats.papers} 张 · ${stats.mb} MB`} chevron={false} />
          <Row icon="shield" iconBg="#1e7a47" title="隐私与权限" onClick={() => go("/pages/privacy/index")} />
          <Row icon="person" iconBg="#1c1c1e" title="账号与登录" value={loginLabel(user.loginMethod)} onClick={() => go("/pages/account/index")} />
        </View>
        <Text className="group-note">试卷照片和电子版只保存在这台手机上，不上传。</Text>
      </View>

      <View className="group">
        <Row icon="info" iconBg="#5b5b63" title="关于错误本" value={VERSION} chevron={false} />
      </View>
      <Text className="t-cap c-sec center">英语、数学、语文、科学 · 小学到高中</Text>
    </View>
  );
}
