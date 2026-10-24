import { useEffect, useMemo, useState } from "react";
import { Picker, Text, View } from "@tarojs/components";
import Taro from "@tarojs/taro";
import { Sheet, SubjectTile } from "../../components/ui";
import { errorText } from "../../lib/api";
import { currentUser, logout, refreshUser, updateProfile } from "../../lib/auth";
import { allErrors } from "../../lib/errors";
import { GRADE_LABEL, SUBJECTS, SUBJECT_LABEL } from "../../lib/format";
import { toast, useDataVersion } from "../../lib/hooks";
import { clearAllFolders, listFolders, photosSizeMB } from "../../lib/store";
import type { Subject } from "../../lib/types";

const GRADES = Object.keys(GRADE_LABEL);
const VERSION = "小程序 1.0.4";

const loginLabel = (m?: string) => (m === "wechat" ? "微信" : m === "apple" ? "Apple" : m === "phone" ? "手机号" : "游客");

/** 我的：昵称、年级与城市（决定知识点按哪套考纲归类）、学科、本机数据、退出 */
export default function Profile() {
  const [version, refresh] = useDataVersion();
  const user = useMemo(() => currentUser(), [version]);
  const folders = useMemo(() => listFolders(), [version]);
  const [city, setCity] = useState<string>(() => Taro.getStorageSync("zcb.city") || "");
  const [editSubjects, setEditSubjects] = useState(false);
  const [subjects, setSubjects] = useState<Subject[]>([]);

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

  const save = async (patch: Record<string, unknown>) => {
    try {
      await updateProfile(patch);
      refresh();
      toast("已更新", "success");
    } catch (e) {
      toast(errorText(e));
    }
  };

  const editName = async () => {
    const m = await Taro.showModal({ title: "怎么称呼你", editable: true, content: user.nickname });
    if (m.confirm && m.content?.trim()) await save({ nickname: m.content.trim().slice(0, 16) });
  };

  const editCity = async () => {
    const m = await Taro.showModal({ title: "所在城市", editable: true, content: city, placeholderText: "例如：上海" });
    if (!m.confirm) return;
    const v = (m.content || "").trim();
    if (v) Taro.setStorageSync("zcb.city", v);
    else Taro.removeStorageSync("zcb.city");
    setCity(v);
  };

  const doClear = async () => {
    const m = await Taro.showModal({
      title: "清空本应用数据？",
      content: `会删掉错误本在这台手机上保存的 ${folders.length} 个文件夹、${stats.papers} 张试卷，以及它们的照片、电子版和错题，不能恢复。账号和学习设置不受影响。`,
      confirmText: "清空",
      confirmColor: "#d92d20",
    });
    if (!m.confirm) return;
    clearAllFolders();
    refresh();
    toast("已清空", "success");
  };

  const doLogout = async () => {
    const m = await Taro.showModal({ title: "退出登录？", content: "本机的试卷和错题不会删除。" });
    if (m.confirm) logout();
  };

  return (
    <View className="page page--tab">
      <View className="card card--row" onClick={editName}>
        <View className="avatar">{user.nickname.slice(-1)}</View>
        <View className="flex1 col gap4 minw0">
          <Text className="t-title3 ellipsis b">{user.nickname}</Text>
          <Text className="t-foot c-sec">{[city, grade].filter(Boolean).join(" · ")}</Text>
          <Text className={`t-cap ${user.loginMethod === "guest" ? "c-sec" : "c-ok"}`}>{user.loginMethod === "guest" ? "游客账号" : `${loginLabel(user.loginMethod)}账号已登录`}</Text>
        </View>
        <Text className="c-ter">›</Text>
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

      <Text className="group-header">学习设置</Text>
      <View className="group">
        <Picker mode="selector" range={GRADES.map((g) => GRADE_LABEL[g])} value={Math.max(0, GRADES.indexOf(user.grade))} onChange={(e) => save({ grade: GRADES[Number(e.detail.value)] })}>
          <View className="list-row">
            <Text className="flex1 t-body">年级</Text>
            <Text className="c-sec">{grade}</Text>
            <Text className="c-ter">›</Text>
          </View>
        </Picker>
        <View className="list-row" onClick={editCity}>
          <Text className="flex1 t-body">城市</Text>
          <Text className="c-sec">{city || "未填"}</Text>
          <Text className="c-ter">›</Text>
        </View>
        <View className="list-row" onClick={() => { setSubjects(user.subjects); setEditSubjects(true); }}>
          <Text className="flex1 t-body">学科</Text>
          <View className="row-center gap4">
            {user.subjects.slice(0, 3).map((s) => (
              <SubjectTile key={s} subject={s} size="xs" />
            ))}
            {user.subjects.length > 3 && <Text className="t-foot c-sec">+{user.subjects.length - 3}</Text>}
            {user.subjects.length === 0 && <Text className="t-foot c-sec">未选</Text>}
          </View>
          <Text className="c-ter">›</Text>
        </View>
      </View>
      <Text className="t-cap c-sec pad12">年级和城市决定错题按哪套考纲归类知识点；试卷上能看出来的以试卷为准。</Text>

      <Text className="group-header">数据与账号</Text>
      <View className="group">
        <View className="list-row">
          <Text className="flex1 t-body">本机试卷照片</Text>
          <Text className="c-sec">
            {stats.papers} 张 · {stats.mb} MB
          </Text>
        </View>
        <View className="list-row">
          <Text className="flex1 t-body">登录方式</Text>
          <Text className="c-sec">{loginLabel(user.loginMethod)}</Text>
        </View>
        <View className="list-row" onClick={doClear}>
          <Text className="flex1 t-body">清空本应用数据</Text>
          <Text className="c-ter">›</Text>
        </View>
        <View className="list-row" onClick={doLogout}>
          <Text className="flex1 t-body c-wrong">退出登录</Text>
        </View>
      </View>
      <Text className="t-cap c-sec pad12">试卷照片和电子版只保存在这台手机上。扫描时照片发到服务器识别，识别完不保留。</Text>

      <View className="group">
        <View className="list-row">
          <Text className="flex1 t-body">关于错误本</Text>
          <Text className="c-sec">{VERSION}</Text>
        </View>
      </View>

      <Sheet open={editSubjects} onClose={() => setEditSubjects(false)} title="学科">
        <View className="row-wrap">
          {SUBJECTS.map((s) => (
            <View key={s} className={`chip${subjects.includes(s) ? " chip--on" : ""}`} onClick={() => setSubjects((v) => (v.includes(s) ? v.filter((x) => x !== s) : [...v, s]))}>
              <SubjectTile subject={s} size="xs" />
              <Text>{SUBJECT_LABEL[s]}</Text>
            </View>
          ))}
        </View>
        <View className="btn" onClick={async () => { setEditSubjects(false); await save({ subjects }); }}>
          保存
        </View>
      </Sheet>
    </View>
  );
}
