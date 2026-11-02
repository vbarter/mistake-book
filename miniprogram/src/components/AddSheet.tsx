/** 添加试卷面板（和 App 的 AddSheet 一致）：拍照（可以连着拍几页）/ 相册导入（一次选多张） */
import { Text, View } from "@tarojs/components";
import { Icon, type IconName } from "./Icon";
import { Sheet } from "./ui";
import type { Source } from "../lib/capture";

function AddTile({ icon, title, sub, onClick }: { icon: IconName; title: string; sub: string; onClick: () => void }) {
  return (
    <View className="add-tile" hoverClass="card--pressed" onClick={onClick}>
      <View className="add-tile__icon">
        <Icon name={icon} size={28} color="#ffffff" stroke={2} />
      </View>
      <Text className="t-headline">{title}</Text>
      <Text className="t-cap c-sec">{sub}</Text>
    </View>
  );
}

export function AddSheet({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (s: Source) => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="添加试卷">
      <View className="add-grid">
        <AddTile icon="camera" title="拍照" sub="可以连着拍几页" onClick={() => onPick("camera")} />
        <AddTile icon="photo" title="相册导入" sub="一次选多张" onClick={() => onPick("album")} />
      </View>
    </Sheet>
  );
}
