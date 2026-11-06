import { useEffect, useMemo, useRef, useState } from "react";
import { Text, View } from "@tarojs/components";
import Taro, { useRouter } from "@tarojs/taro";
import { Icon } from "../../components/Icon";
import { PrintSheets } from "../../components/PrintSheets";
import { Button, Empty, Hint } from "../../components/ui";
import { ERASE_EVENT, allErased, erasePaper, eraseProgress, eraseWarning } from "../../lib/erase";
import { errorText } from "../../lib/api";
import { ensureLogin, isLoggedIn } from "../../lib/auth";
import { submitExport } from "../../lib/export";
import { figureAt, figurePayload, figurePhotoIds } from "../../lib/figures";
import { useDataVersion } from "../../lib/hooks";
import { scanStageText } from "../../lib/jobs";
import { validDigitized } from "../../lib/logic";
import { getFolder } from "../../lib/store";
import { C } from "../../lib/theme";

/**
 * 擦除手写 = 原题空白卷（和 App 一致）：题目用扫描识别出的文字重排（题干、选项、空位留白），作答、批改、得分都不要；
 * 导出的 PDF 也是文字版，不放整张照片。只有插图（几何图、统计图等）还得从照片里裁，
 * 所以把有插图的照片放到服务器后台擦一遍手写，插图从擦过的照片里裁。
 */
export default function ErasePage() {
  const { params } = useRouter();
  const folderId = params.folderId ?? "";
  const paperId = params.paperId ?? "";
  const [version, refresh] = useDataVersion();
  const [tick, setTick] = useState(0);
  const [exporting, setExporting] = useState(false);
  const started = useRef(false);

  // 擦除进度变了、擦好一张存下来了：重新读记录，插图换成擦过的
  useEffect(() => {
    const on = () => setTick((x) => x + 1);
    Taro.eventCenter.on(ERASE_EVENT, on);
    return () => {
      Taro.eventCenter.off(ERASE_EVENT, on);
    };
  }, []);

  const folder = useMemo(() => getFolder(folderId), [folderId, version, tick]);
  const paper = folder?.papers.find((p) => p.id === paperId);
  const digitized = paper ? validDigitized(paper.digitized) : null;
  const figIds = paper && digitized ? figurePhotoIds(paper) : [];
  const progress = eraseProgress(paperId);
  const warning = eraseWarning(paperId);

  // 有插图的照片还没擦过：进来就开始擦（只擦这几张）
  useEffect(() => {
    if (!paper || !digitized || started.current || paper.eraseJob || allErased(paper, figIds) || !isLoggedIn()) return;
    started.current = true;
    erasePaper(folderId, paper, figIds.filter((id) => !paper.pages.find((pg) => pg.id === id)?.erased)).catch((e) => Taro.showModal({ title: "擦除没开始", content: errorText(e), showCancel: false }));
  }, [paper?.id, Boolean(digitized)]);

  if (!folder || !paper) return <Empty icon="document" title="试卷不存在" />;

  if (!digitized) {
    return (
      <View className="page center-page">
        <Icon name={paper.scanJob ? "sparkles" : "brush"} size={44} color={C.brand} />
        {paper.scanJob ? (
          <>
            <Text className="t-title3">正在扫描「{paper.name}」</Text>
            <Text className="t-sub c-sec center">{scanStageText(paper.scanJob)}。扫好后这里会显示去掉作答的原题</Text>
          </>
        ) : (
          <>
            <Text className="t-title3">先扫描这张试卷</Text>
            <Text className="t-sub c-sec center">空白卷是用扫描识别出的原题重新排版的，扫描后就能导出</Text>
            <Button size="sm" onClick={() => Taro.redirectTo({ url: `/pages/paper/index?folderId=${folderId}&paperId=${paperId}` })}>
              去扫描
            </Button>
          </>
        )}
      </View>
    );
  }

  const busy = !!progress || !!paper.eraseJob;
  const done = progress?.done ?? paper.eraseJob?.done ?? 0;
  const total = progress?.total ?? paper.eraseJob?.total ?? figIds.length;

  const exportClean = async () => {
    if (exporting || busy) return;
    if (!(await ensureLogin("导出空白卷"))) return;
    setExporting(true);
    Taro.showLoading({ title: "正在提交…", mask: true });
    try {
      const pages = await Promise.all(
        digitized.pages.map(async (s, si) => ({
          ...s,
          blocks: await Promise.all(
            s.blocks.map(async (b, bi) => {
              const f = b.type === "figure" ? figureAt(paper, si, bi, true) : null;
              return f ? { ...b, image: (await figurePayload(f)).image } : b;
            }),
          ),
        })),
      );
      const job = await submitExport({ kind: "clean", title: `${paper.name} 空白卷`, papers: [{ title: paper.name, pages }] });
      Taro.hideLoading();
      if (!job) void Taro.showModal({ title: "暂时导不了", content: "服务器还不支持导出空白卷，请稍后再试", showCancel: false });
      else void Taro.showToast({ title: "已开始生成，好了会提醒你", icon: "none", duration: 2500 });
    } catch (e) {
      Taro.hideLoading();
      void Taro.showModal({ title: "导出失败", content: errorText(e), showCancel: false });
    } finally {
      setExporting(false);
    }
  };

  return (
    <View className="page">
      <View className="row-center" style={{ padding: "4px 4px 0" }}>
        <Text className="t-headline ellipsis flex1 minw0">{paper.name}</Text>
        <Text className="t-foot c-sec">{digitized.pages.length} 个卷面</Text>
      </View>
      <Hint icon="brush">只保留印刷的原题，空格留白，作答、批改和得分都去掉了。导出的是文字版 PDF。</Hint>
      {figIds.length > 0 && busy && (
        <View className="erase__status">
          <View className="spinner" style={{ width: "14px", height: "14px" }} />
          <Text className="flex1">
            插图上的手写正在后台擦除（{done}/{total} 张照片），可以先离开，擦好会提醒你
          </Text>
        </View>
      )}
      {warning && !busy && (
        <View className="erase__warn">
          <Icon name="alert" size={14} color={C.accentOn} stroke={2.4} />
          <Text className="flex1">{warning}</Text>
        </View>
      )}
      <PrintSheets paper={paper} sheets={digitized.pages} clean />
      <View className="bottom-bar">
        {figIds.length > 0 && (
          <Button variant="outline" disabled={busy} onClick={async () => (await ensureLogin("擦除手写")) && erasePaper(folderId, paper, figIds).then(refresh).catch((e) => Taro.showModal({ title: "擦除没开始", content: errorText(e), showCancel: false }))}>
            重擦插图
          </Button>
        )}
        <Button icon="export" disabled={busy || exporting} style={{ flex: 1 }} onClick={exportClean}>
          {exporting ? "提交中…" : busy ? "插图擦除中…" : "导出空白卷 PDF"}
        </Button>
      </View>
    </View>
  );
}
