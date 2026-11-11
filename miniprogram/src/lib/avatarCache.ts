/**
 * 头像缓存。
 *
 * 服务端每次返回的头像都是新签的临时链接，同一张图地址也不一样，图片组件会当成新图重新下载，进页面就闪一下。
 * 这里按「谁的头像 + 第几版」认图（地址里的 u/<用户>/avatar-<版本>.jpg）：
 * 第一次见到时下载到本地，之后一直用本地文件；换了头像版本号会变，旧文件顺手删掉。
 * 本地还没下好之前，同一版头像固定用第一次见到的地址，页面重新拉数据也不会换图。
 */
import Taro from "@tarojs/taro";

const STORE_KEY = "syk.avatarCache";
const DIR = `${Taro.env.USER_DATA_PATH}/avatars`;
const MAX_USERS = 300;

interface Entry { v: string; path: string; at: number }

let files: Record<string, Entry> | null = null; // 用户 → 已下到本地的那一版
const firstSeen = new Map<string, string>(); // 用户/版本 → 这次启动第一次见到的地址
const busy = new Set<string>();

function load(): Record<string, Entry> {
  if (!files) {
    try {
      files = (Taro.getStorageSync(STORE_KEY) as Record<string, Entry>) || {};
    } catch {
      files = {};
    }
  }
  return files;
}

function save() {
  try {
    Taro.setStorageSync(STORE_KEY, load());
  } catch {
    /* 存不下就算了，下次再下载 */
  }
}

function unlink(path: string) {
  try {
    Taro.getFileSystemManager().unlinkSync(path);
  } catch {
    /* 已经不在了 */
  }
}

function absolute(url: string): string {
  return url.startsWith("/") ? `${API_BASE}${url}` : url;
}

function parse(url: string): { user: string; v: string } | null {
  const m = /\/u\/([^/?#]+)\/avatar-([\w-]+)\.jpg/.exec(url);
  return m ? { user: m[1], v: m[2] } : null;
}

async function download(user: string, v: string, url: string) {
  const id = `${user}/${v}`;
  if (busy.has(id)) return;
  busy.add(id);
  try {
    const fs = Taro.getFileSystemManager();
    try {
      fs.mkdirSync(DIR, true);
    } catch {
      /* 已经有了 */
    }
    const dest = `${DIR}/${user.replace(/[^\w-]/g, "_")}-${v}.jpg`;
    const r = await Taro.downloadFile({ url, filePath: dest } as Taro.downloadFile.Option);
    if (r.statusCode !== 200) {
      unlink(dest);
      return;
    }
    const map = load();
    const old = map[user];
    map[user] = { v, path: dest, at: Date.now() };
    if (old && old.path !== dest) unlink(old.path);
    const users = Object.keys(map);
    if (users.length > MAX_USERS) {
      users.sort((a, b) => map[a].at - map[b].at);
      for (const u of users.slice(0, users.length - MAX_USERS)) {
        unlink(map[u].path);
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
  const remote = absolute(url);
  const p = parse(url);
  if (!p) return remote;
  const hit = load()[p.user];
  if (hit && hit.v === p.v) return hit.path;
  const id = `${p.user}/${p.v}`;
  const first = firstSeen.get(id);
  if (first) return first;
  firstSeen.set(id, remote);
  void download(p.user, p.v, remote);
  return remote;
}

/** 缓存的图显示不出来（文件被清了、链接过期了）：忘掉它，返回最新的远程地址 */
export function avatarFallback(url: string): string {
  const remote = absolute(url);
  const p = parse(url);
  if (p) {
    const map = load();
    const hit = map[p.user];
    if (hit && hit.v === p.v) {
      unlink(hit.path);
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
