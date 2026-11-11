/**
 * 头像缓存。
 *
 * 服务端每次返回的头像都是新签的临时链接，同一张图地址也不一样，<img> 会当成新图重新下载，进页面就闪一下。
 * 这里按「谁的头像 + 第几版」认图（地址里的 u/<用户>/avatar-<版本>.jpg）：
 * 同一版头像固定用第一次见到的地址，页面重新拉数据不换图；
 * App 里再把图下到缓存目录，之后（包括下次打开）直接用本地文件。换了头像版本号会变，自然用新图。
 */
import { Capacitor } from "@capacitor/core";
import { assetUrl } from "../api/client";

const STORE_KEY = "syk.avatarCache";
const MAX_USERS = 300;

interface Entry { v: string; src: string; path: string; at: number }

let files: Record<string, Entry> | null = null; // 用户 → 已下到本地的那一版
const firstSeen = new Map<string, string>(); // 用户/版本 → 这次启动第一次见到的地址
const busy = new Set<string>();

function load(): Record<string, Entry> {
  if (!files) {
    try {
      files = JSON.parse(localStorage.getItem(STORE_KEY) || "{}") as Record<string, Entry>;
    } catch {
      files = {};
    }
  }
  return files;
}

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(load()));
  } catch {
    /* 存不下就算了，下次再下载 */
  }
}

function parse(url: string): { user: string; v: string } | null {
  const m = /\/u\/([^/?#]+)\/avatar-([\w-]+)\.jpg/.exec(url);
  return m ? { user: m[1], v: m[2] } : null;
}

async function remove(path: string) {
  try {
    const { Filesystem, Directory } = await import("@capacitor/filesystem");
    await Filesystem.deleteFile({ path, directory: Directory.Cache });
  } catch {
    /* 已经不在了 */
  }
}

async function download(user: string, v: string, url: string) {
  if (!Capacitor.isNativePlatform()) return; // 网页版靠浏览器自己的缓存
  const id = `${user}/${v}`;
  if (busy.has(id)) return;
  busy.add(id);
  try {
    const { Filesystem, Directory } = await import("@capacitor/filesystem");
    const path = `avatars/${user.replace(/[^\w-]/g, "_")}-${v}.jpg`;
    await Filesystem.downloadFile({ url, path, directory: Directory.Cache, recursive: true });
    const st = await Filesystem.stat({ path, directory: Directory.Cache });
    if (!st.size) return;
    const map = load();
    const old = map[user];
    map[user] = { v, src: Capacitor.convertFileSrc(st.uri), path, at: Date.now() };
    if (old && old.path !== path) void remove(old.path);
    const users = Object.keys(map);
    if (users.length > MAX_USERS) {
      users.sort((a, b) => map[a].at - map[b].at);
      for (const u of users.slice(0, users.length - MAX_USERS)) {
        void remove(map[u].path);
        delete map[u];
      }
    }
    save();
  } catch {
    /* 下载失败不影响显示，下次再试 */
  } finally {
    busy.delete(id);
  }
}

/** 头像该用哪个地址显示：本地有就用本地的，没有就用远程地址并在后台下载 */
export function avatarSrc(url: string): string {
  const remote = assetUrl(url)!;
  const p = parse(url);
  if (!p) return remote;
  const hit = load()[p.user];
  if (hit && hit.v === p.v) return hit.src;
  const id = `${p.user}/${p.v}`;
  const first = firstSeen.get(id);
  if (first) return first;
  firstSeen.set(id, remote);
  void download(p.user, p.v, remote);
  return remote;
}

/** 缓存的图显示不出来（系统清了缓存目录、链接过期了）：忘掉它，返回最新的远程地址 */
export function avatarFallback(url: string): string {
  const remote = assetUrl(url)!;
  const p = parse(url);
  if (p) {
    const map = load();
    const hit = map[p.user];
    if (hit && hit.v === p.v) {
      void remove(hit.path);
      delete map[p.user];
      save();
    }
    firstSeen.set(`${p.user}/${p.v}`, remote);
    void download(p.user, p.v, remote);
  }
  return remote;
}

/** 认图用的标识：同一个人同一版头像不变 */
export function avatarId(url: string): string {
  const p = parse(url);
  return p ? `${p.user}/${p.v}` : url;
}
