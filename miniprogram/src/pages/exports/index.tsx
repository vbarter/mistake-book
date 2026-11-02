import { useEffect, useState } from "react";
import { Text, View } from "@tarojs/components";
import Taro, { useDidShow, usePullDownRefresh } from "@tarojs/taro";
import { Icon } from "../../components/Icon";
import { Empty, Tag } from "../../components/ui";
import { errorText } from "../../lib/api";
import { EXPORTS_EVENT, isPending, listExports, openExport, removeExport, type ExportJob } from "../../lib/export";
import { formatDateTime } from "../../lib/format";
import { toast } from "../../lib/hooks";
import { C } from "../../lib/theme";

const sizeLabel = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** 我的导出（和 App 一致）：最近 7 天在服务器上生成的错题本 / 电子试卷 / 空白卷，点一下下载打开；生成中的自动刷新。 */
export default function Exports() {
  const [items, setItems] = useState<ExportJob[] | null>(null);

  const refresh = async () => {
    try {
      setItems(await listExports());
    } catch (e) {
      setItems((v) => v ?? []);
      toast(errorText(e));
    }
  };

  useDidShow(() => {
    void refresh();
  });
  usePullDownRefresh(async () => {
    await refresh();
    Taro.stopPullDownRefresh();
  });
  useEffect(() => {
    const on = () => void refresh();
    Taro.eventCenter.on(EXPORTS_EVENT, on);
    return () => {
      Taro.eventCenter.off(EXPORTS_EVENT, on);
    };
  }, []);
  // 有生成中的：隔几秒再问一次
  useEffect(() => {
    if (!items?.some(isPending)) return;
    const t = setTimeout(() => void refresh(), 3000);
    return () => clearTimeout(t);
  }, [items]);

  const del = async (job: ExportJob) => {
    const m = await Taro.showModal({ title: "删除这份导出？", content: job.title, confirmText: "删除", confirmColor: C.wrong });
    if (!m.confirm) return;
    try {
      await removeExport(job.id);
      setItems((v) => (v ?? []).filter((j) => j.id !== job.id));
    } catch (e) {
      toast(errorText(e));
    }
  };

  return (
    <View className="page" style={{ gap: "10px" }}>
      {items && items.length === 0 && <Empty icon="export" title="还没有导出过" text="在首页、文件夹或试卷里点「导出」，PDF 会在后台生成，放在这里。" />}
      {(items ?? []).map((job) => {
        const pending = isPending(job);
        return (
          <View key={job.id} className="card card--row" hoverClass={job.status === "done" ? "card--pressed" : "none"} onClick={() => job.status === "done" && openExport(job)}>
            <View className="tile tile--sm" style={{ background: C.brandTint }}>
              <Icon name={job.kind === "book" ? "book" : job.kind === "blank" || job.kind === "clean" ? "brush" : "document"} size={20} color={C.brand} stroke={2.2} />
            </View>
            <View className="flex1 col gap2 minw0">
              <Text className="t-headline ellipsis">{job.title}</Text>
              {job.detail && <Text className="t-foot c-sec ellipsis">{job.detail}</Text>}
              <Text className="t-cap c-sec">
                {formatDateTime(job.createdAt)}
                {job.status === "done" ? ` · ${job.pages} 页 · ${sizeLabel(job.size)}` : ""}
              </Text>
              {job.status === "failed" && <Text className="t-cap c-wrong">{job.error || "生成失败"}</Text>}
            </View>
            {pending && (
              <Tag kind="pending" icon="clock">
                生成中
              </Tag>
            )}
            {job.status === "done" && <Icon name="export" size={20} color={C.brand} stroke={2.2} />}
            {!pending && (
              <View
                style={{ padding: "6px" }}
                onClick={(e) => {
                  e.stopPropagation();
                  void del(job);
                }}
              >
                <Icon name="trash" size={18} color={C.tertiary} stroke={2} />
              </View>
            )}
          </View>
        );
      })}
      {items && items.length > 0 && <Text className="group-note">导出的 PDF 在服务器上保留 7 天，方便换个时间再下载；不需要了可以删掉。</Text>}
    </View>
  );
}
