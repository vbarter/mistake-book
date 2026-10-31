import { useEffect, useState, type CSSProperties } from "react";
import { loadPhoto, thumbOf, type FolderPage } from "../lib/folders";

/** 一张试卷照片的原图：先显示小图，原图从本机读出来再换上；离开页面就放掉 */
export function StoredPhoto({ page, alt, style }: { page: FolderPage; alt: string; style?: CSSProperties }) {
  const [src, setSrc] = useState<string | null>(page.src ?? null);
  useEffect(() => {
    let alive = true;
    void loadPhoto(page).then((s) => alive && setSrc(s)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [page.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return <img src={src ?? thumbOf(page)} alt={alt} style={style} />;
}
