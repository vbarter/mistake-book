import { useMemo, useState } from "react";
import { Input, Text, View } from "@tarojs/components";
import Taro from "@tarojs/taro";
import { Icon } from "../../components/Icon";
import { SubjectTile } from "../../components/ui";
import { errorText } from "../../lib/api";
import { currentUser, updateProfile } from "../../lib/auth";
import { GRADE_GROUPS, GRADE_LABEL, SUBJECTS, SUBJECT_GROUPS, SUBJECT_LABEL } from "../../lib/format";
import { toast } from "../../lib/hooks";
import type { Subject } from "../../lib/types";

/** 年级、城市与学科（和 App 的同名页面一致） */
export default function Settings() {
  const user = useMemo(() => currentUser(), []);
  const [grade, setGrade] = useState(user?.grade ?? "5");
  const [city, setCity] = useState<string>(() => (Taro.getStorageSync("zcb.city") as string) || "");
  const [subjects, setSubjects] = useState<Subject[]>(user?.subjects?.length ? user.subjects : SUBJECTS);
  const [busy, setBusy] = useState(false);

  const toggle = (s: Subject) => setSubjects((cur) => (cur.includes(s) ? (cur.length > 1 ? cur.filter((x) => x !== s) : cur) : [...cur, s]));

  const save = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await updateProfile({ subjects, grade });
      const c = city.trim();
      if (c) Taro.setStorageSync("zcb.city", c);
      else Taro.removeStorageSync("zcb.city");
      toast("已保存", "success");
      setTimeout(() => Taro.navigateBack(), 600);
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View className="page">
      <View className="card">
        <Text className="t-headline">年级</Text>
        {GRADE_GROUPS.map((g) => (
          <View key={g.label} className="col gap6">
            <Text className="t-cap c-sec">{g.label}</Text>
            <View className="seg">
              {g.grades.map((k) => (
                <View key={k} className={`seg__item${grade === k ? " on" : ""}`} onClick={() => setGrade(k)}>
                  {GRADE_LABEL[k].replace("年级", "")}
                </View>
              ))}
            </View>
          </View>
        ))}
      </View>

      <View className="card">
        <Text className="t-headline">所在城市</Text>
        <Input className="input" value={city} maxlength={20} placeholder="例如：上海" onInput={(e) => setCity(e.detail.value)} />
        <Text className="t-foot c-sec">错题会按这个城市的考纲归类知识点；试卷上能看出地区的以试卷为准。</Text>
      </View>

      {SUBJECT_GROUPS.map((g) => (
        <View key={g.label} className="col">
          <View className="group-title row-center">
            <Text className="flex1">学科 · {g.label}</Text>
            {g.label === "基础" && <Text>至少保留一科</Text>}
          </View>
          <View className="group">
            {g.subjects.map((s) => {
              const on = subjects.includes(s);
              return (
                <View key={s} className="prow" hoverClass="prow--pressed" onClick={() => toggle(s)}>
                  <SubjectTile subject={s} size="sm" />
                  <Text className="prow__title">{SUBJECT_LABEL[s]}</Text>
                  <Icon name={on ? "checkcircle" : "target"} size={24} color={on ? "#2f6fed" : "#d1d1d6"} stroke={on ? 2.2 : 1.6} />
                </View>
              );
            })}
          </View>
        </View>
      ))}
      <Text className="group-note">这里勾选的学科只影响错题库的排序，扫描时会自动识别卷子是哪一科。</Text>

      <View className="bottom-bar">
        <View className={`btn flex1${busy ? " btn--disabled" : ""}`} onClick={save}>
          {busy ? "保存中…" : "保存"}
        </View>
      </View>
    </View>
  );
}
