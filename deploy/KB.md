# 智能聊天「问小壹」：接通试卷知识库

App 里的对话助手调用的是另一个服务「试卷知识库」（`eduction_rag` 项目，FastAPI，默认 8000 端口）。
主站后端只做一件事：给登录用户发一张访问知识库的短期票（`POST /api/kb/token`）。**两项配置都填了，App 才显示对话入口**；不填就和没有这个功能一样。

## 1. 两边的配置

主站后端 `.env`：

```
KB_PUBLIC_URL=https://<主站域名>/kb      # App 访问知识库的地址；也可以写相对路径 /kb（跟着主站域名走）
KB_JWT_SECRET=<一串 32 位以上的随机字符>   # 单独的密钥，不要和 JWT_SECRET_KEY 相同
# KB_TOKEN_TTL=3600                      # 票的有效期（秒）
```

知识库 `.env`：

```
JWT_SECRET=<和上面 KB_JWT_SECRET 一样>
JWT_ALGORITHM=HS256
# CORS_ORIGINS 默认已包含 App 的 WebView 来源（capacitor://localhost、http://localhost）
```

知识库按票里的 `sub`（`zcb:<用户 id>`）建用户、隔离个人库。知识库需要是带「App 对话」改动的版本
（`history`、`filters.paper_ids`、引用带题干、CORS）；老版本 App 也能用，只是追问靠把上一问拼进问题、不能「只问这一份」。

## 2. 入口怎么搭（推荐：主站域名下开 /kb/，转到知识库）

App 只认主站域名，HTTPS、备案都是现成的。知识库在别的机器上（比如家里的 Mac Studio）时，用 frp 之类的反向隧道把它的 8000 端口映射到服务器本机的某个端口（下面用 18000），Nginx 再转过去：

```nginx
# 只放行对话用到的几个接口，其余一律 404（管理接口、接口文档都不对外）
location ~ ^/kb/(v1/personal/papers|v1/(personal|system)/(search|answers/stream)|v1/tasks/[A-Za-z0-9_]+|v1/(personal|system)/questions/[A-Za-z0-9_]+)$ {
    rewrite ^/kb/(.*)$ /$1 break;
    proxy_pass http://127.0.0.1:18000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    client_max_body_size 50m;      # 上传试卷的上限
    proxy_buffering off;           # 流式回答：不缓冲，边生成边下发
    proxy_read_timeout 300s;
}
location /kb/ { return 404; }
```

跨域（CORS）由知识库自己回，Nginx 不用再加响应头。

临时测试也可以直接把 `KB_PUBLIC_URL` 填成知识库的 ngrok 地址（`scripts/tunnel.sh url`），App 会自动带上 `ngrok-skip-browser-warning` 头；国内网络下不稳定，不建议给用户用。

## 2b. 另一种入口：单独的子域名转到 ngrok（rag.openmindai.cn）

知识库继续用 ngrok 固定域名出公网（`https://rag.openmindai.cn.ngrok.app`），上海服务器上给 `rag.openmindai.cn` 单开一个站点转过去。
App 和小程序都只认 `rag.openmindai.cn`（小程序后台的 request / uploadFile 合法域名都要填它）。主站 `.env`：`KB_PUBLIC_URL=https://rag.openmindai.cn`。

要做三件事：

1. 给 `rag.openmindai.cn` 签证书（`certbot --nginx -d rag.openmindai.cn`）。没有证书时 HTTPS 会落到服务器上别的站点，App 和小程序都连不上。
2. Nginx 加站点：

```nginx
server {
    listen 443 ssl;
    server_name rag.openmindai.cn;
    # ssl_certificate / ssl_certificate_key 由 certbot 写入

    location ~ ^/(healthz|v1/personal/papers|v1/(personal|system)/(search|answers/stream)|v1/tasks/[A-Za-z0-9_]+|v1/(personal|system)/questions/[A-Za-z0-9_]+)$ {
        proxy_pass https://rag.openmindai.cn.ngrok.app;
        proxy_ssl_server_name on;                          # 上游是 HTTPS，要带 SNI
        proxy_set_header Host rag.openmindai.cn.ngrok.app; # ngrok 按 Host 认隧道
        proxy_set_header ngrok-skip-browser-warning 1;     # 免费隧道不加这个头会先返回一张提示网页
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_http_version 1.1;
        client_max_body_size 50m;
        proxy_buffering off;                               # 流式回答不缓冲
        proxy_request_buffering off;
        proxy_read_timeout 300s;
    }
    location / { return 404; }
}
```

3. 知识库用带「App 对话」改动的版本，并重启隧道（`scripts/tunnel.sh stop && scripts/tunnel.sh start`）让新的白名单生效：
   App 的 WebView 是跨域调用，浏览器会先发 `OPTIONS` 预检，老版本的白名单会把它挡成 404。小程序不走跨域，不受这条影响。

注意：这条路上海服务器要能稳定连到 ngrok（境外）。连不稳的话改用第 2 节的反向隧道（frp 把 Mac 的 8000 映射到服务器本机），Nginx 站点不变，只把 `proxy_pass` 换成 `http://127.0.0.1:18000` 并去掉 ngrok 相关的三行。

## 3. 本机开发

- 知识库起在 8000；主站后端 `.env` 里 `KB_PUBLIC_URL=/kb`、`KB_JWT_SECRET` 和知识库的 `JWT_SECRET` 一致；
- `npm run dev` 时 Vite 把 `/kb` 转到 `http://127.0.0.1:8000`（换端口用环境变量 `KB_PROXY`）。

## 4. 验证

```bash
TOKEN=<App 登录后的 token>
curl -s -X POST https://<主站域名>/api/kb/token -H "Authorization: Bearer $TOKEN"        # 应返回 token / base
KB=<上一步返回的 token>
curl -s -X POST https://<主站域名>/kb/v1/personal/search -H "Authorization: Bearer $KB" \
     -H 'Content-Type: application/json' -d '{"query":"配方法"}'                          # 应返回 items
```
