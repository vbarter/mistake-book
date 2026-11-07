import { useEffect, useMemo, useState } from "react";
import { ScrollView, Swiper, SwiperItem, Text, View } from "@tarojs/components";
import Taro, { useRouter } from "@tarojs/taro";
import { ErrorCard } from "../../components/ErrorCard";
import { Icon } from "../../components/Icon";
import { Button, Empty } from "../../components/ui";
import { allErrors, type ErrorItem } from "../../lib/errors";
import { getRankView } from "../../lib/rankView";
import { listFolders } from "../../lib/store";
import { C } from "../../lib/theme";
import { useShare } from "../../lib/share";

/** 只渲染当前这张和左右各 NEAR 张：整张榜上百题一起画，插图同时裁图很占内存（和 App 一样的做法） */
const NEAR = 1;

/**
 * 错题详情（和 App 一致）：从错题榜点进来，整张榜的题按名次排成一行，左右滑一张一张看。
 * 每张顶部是名次、所属知识点和易错指数，下面是原题、作答、正确答案和解析。
 */
export default function RankDetail() {
  useShare();
  const { params } = useRouter();
  const { title, entries } = useMemo(() => getRankView(), []);
  const [current, setCurrent] = useState(Number(params.index) || 0);

  useEffect(() => {
    void Taro.setNavigationBarTitle({ title: title || "错题详情" });
  }, [title]);

  const slides = useMemo(() => {
    const items = new Map<string, ErrorItem>(allErrors(listFolders()).map((e) => [e.key, e]));
    return entries.map((en) => ({ en, item: items.get(en.key) })).filter((s): s is { en: (typeof entries)[number]; item: ErrorItem } => Boolean(s.item));
  }, [entries]);

  if (slides.length === 0)
    return (
      <View className="page">
        <Empty icon="seal" title="这道题找不到了">
          <Button size="sm" variant="tinted" onClick={() => Taro.navigateBack()}>
            回到错题榜
          </Button>
        </Empty>
      </View>
    );

  const at = Math.min(current, slides.length - 1);
  return (
    <View className="detail">
      <Swiper className="detail__swiper" current={at} onChange={(e) => setCurrent(e.detail.current)}>
        {slides.map(({ en, item }, i) => (
          <SwiperItem key={item.key} className="detail__slide">
            {Math.abs(i - at) > NEAR ? null : (
              <ScrollView scrollY className="detail__scroll" enhanced showScrollbar={false}>
                <View className="detail__inner">
                  <View className="detail-head">
                    <Text className={`rank-badge num${en.rank <= 3 ? " rank-badge--top" : ""}`}>{en.rank}</Text>
                    <View className="flex1 col gap4 minw0">
                      <Text className="t-headline ellipsis">{en.group || item.knowledge}</Text>
                      <Text className="t-foot c-sec ellipsis">
                        {item.folderName} · {item.paperName} · 第 {item.q.number} 题
                      </Text>
                    </View>
                    <View className="rank-index">
                      <Text className="rank-index__num num">{Math.round(en.score)}</Text>
                      <Text className="rank-index__label">易错指数</Text>
                    </View>
                  </View>
                  <ErrorCard item={item} />
                </View>
              </ScrollView>
            )}
          </SwiperItem>
        ))}
      </Swiper>
      {slides.length > 1 && (
        <View className="detail-nav">
          <View className={`detail-nav__btn${at === 0 ? " detail-nav__btn--off" : ""}`} onClick={() => at > 0 && setCurrent(at - 1)}>
            <Icon name="chevron-left" size={22} color={C.brand} stroke={2.4} />
          </View>
          <Text className="detail-count num">
            {at + 1} / {slides.length}
          </Text>
          <View className={`detail-nav__btn${at === slides.length - 1 ? " detail-nav__btn--off" : ""}`} onClick={() => at < slides.length - 1 && setCurrent(at + 1)}>
            <Icon name="chevron-right" size={22} color={C.brand} stroke={2.4} />
          </View>
        </View>
      )}
    </View>
  );
}
