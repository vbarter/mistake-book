import { useState } from "react";
import { Text, View } from "@tarojs/components";
import type { ErrorItem } from "../lib/errors";
import { exportBook, exportPapers } from "../lib/export";
import { validDigitized } from "../lib/logic";
import type { Paper } from "../lib/store";
import { toBookItems } from "../lib/errors";
import { Sheet, Tag } from "./ui";

/** 导出面板：错题本（推荐）或原始电子试卷；papers 不传时只出错题本 */
export function ExportSheet({ open, onClose, title, subtitle, errors, papers }: { open: boolean; onClose: () => void; title: string; subtitle?: string; errors: ErrorItem[]; papers?: Paper[] }) {
  const [kind, setKind] = useState<"book" | "paper">("book");
  const [withWrong, setWithWrong] = useState(true);
  const [withBlank, setWithBlank] = useState(true);
  const wrong = errors.filter((e) => e.kind !== "未作答").length;
  const blank = errors.length - wrong;
  const chosen = errors.filter((e) => (e.kind === "未作答" ? withBlank : withWrong));
  const scanned = (papers ?? []).filter((p) => validDigitized(p.digitized)).length;
  const pages = Math.max(1, Math.ceil(toBookItems(chosen).length / 3));

  const go = async () => {
    onClose();
    if (kind === "book") await exportBook(title, subtitle, errors, withWrong, withBlank);
    else await exportPapers(title, papers ?? []);
  };

  return (
    <Sheet open={open} onClose={onClose} title={`导出「${title}」`}>
      <Text className="t-foot c-sec">生成 PDF 后可以转发给微信好友、打印或存到手机</Text>
      <View className={`card pick${kind === "book" ? " pick--on" : ""}`} onClick={() => setKind("book")}>
        <View className="row-center">
          <Text className="t-headline">错题本</Text>
          <Tag kind="accent">推荐</Tag>
        </View>
        <Text className="t-foot c-sec">横向打印。左边空白重做，右边错题修正，对折就能自测。</Text>
        <Text className="t-cap c-sec">
          {chosen.length} 题 · 约 {pages} 页
        </Text>
      </View>
      {papers && (
        <View className={`card pick${kind === "paper" ? " pick--on" : ""}`} onClick={() => setKind("paper")}>
          <Text className="t-headline">原始电子试卷</Text>
          <Text className="t-foot c-sec">还原后的干净原卷，空格留白，可以整张再做一遍；附作答与批改对照表。</Text>
          <Text className="t-cap c-sec">{scanned} 张试卷</Text>
        </View>
      )}
      {kind === "book" && (
        <View className="row-wrap">
          <View className={`chip${withWrong ? " chip--on" : ""}`} onClick={() => setWithWrong(!withWrong || !withBlank ? true : false)}>
            错题 {wrong}
          </View>
          <View className={`chip${withBlank ? " chip--on" : ""}`} onClick={() => setWithBlank(!withBlank || !withWrong ? true : false)}>
            未作答 {blank}
          </View>
        </View>
      )}
      <View className="btn" onClick={go}>
        生成 PDF
      </View>
      <View className="btn btn--plain" onClick={onClose}>
        取消
      </View>
    </Sheet>
  );
}
