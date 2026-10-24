/* ================= 离线缓存 =================
   目的：让「拾句」能装进手机桌面，并在断网时照常打开。

   策略是「先问网络，不通才用缓存」（network-first）：
   打开时一律向服务器取最新的页面与脚本，取到什么就用什么，
   顺手存一份进缓存；只有断网（或服务器没响应）时才拿缓存里那份顶上。

   为什么不用「先用缓存出画面、后台悄悄换新」：
   那种做法打开确实更快，但按下发布后，第一次打开交付的仍是上一版内容，
   要再打开一次才更新——表现为"我刚改完，手机上看怎么还是老样子"。
   本站总共不到 300 KB，向服务器核对一次（内容没变时服务器只回 304）
   的开销，远小于"用户以为没生效"的代价。

   这里只缓存「外壳」（页面骨架、样式、脚本、图标）与「数据文件」。
   手记存在 localStorage、导入的个人数据包存在 IndexedDB，
   两者都不归本文件管——清缓存不会丢手记。

   若日后改动了 index.html 依赖的资源清单，把 VERSION 改一位即可，
   旧缓存会在下一次打开时自动清理。 */

var VERSION = 'shiju-20261025-0008';
var SHELL = 'shiju-shell-' + VERSION;

/* 安装时预取的外壳资源。
   有了它，装到桌面后的第一次打开就已经具备断网可用的能力；
   刻意不含 data.local.js：它是个人数据、且部署时未必上传，
   缺失不应导致安装失败。 */
var PRECACHE = [
  './',
  './index.html',
  './manifest.json',
  './assets/style.css',
  './assets/app.js',
  './assets/share.js',
  './assets/favicon.svg',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/apple-touch-icon.png',
  './data/data.js'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(SHELL).then(function (c) {
      /* 逐个缓存并各自吞掉失败：单个文件拿不到，不该让整次安装作废 */
      return Promise.all(PRECACHE.map(function (u) {
        return c.add(new Request(u, { cache: 'reload' })).catch(function () {});
      }));
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== SHELL) return caches.delete(k);
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

/* 向服务器取新的一份。
   cache:'no-cache' 的意思是"别信浏览器本地副本的保鲜期，每次都跟服务器核对一遍"：
   不这么写的话，浏览器可能直接拿几小时前的 HTTP 缓存糊弄我们，
   "先问网络"就白问了。服务器内容没变时只回一个 304，开销很小。

   注意：写缓存必须并进同一条 Promise 链。调用方等的是这条链，
   若把 caches.open(...).put(...) 挂在链外当"发射后不管"，
   Service Worker 在响应交付后随时可能被浏览器回收，这次写入就丢了。 */
function fetchFresh(req) {
  return fetch(req, { cache: 'no-cache' }).then(function (res) {
    if (!res || res.status !== 200 || res.type !== 'basic') return res;
    var copy = res.clone();
    return caches.open(SHELL).then(function (c) {
      return c.put(req, copy);
    }).then(function () {
      return res;
    }).catch(function () {
      return res;             /* 缓存写失败不该影响这一次的交付 */
    });
  });
}

/* 网络不通时的退路：用缓存里那份。
   导航请求再兜底到首页，免得断网时只见到浏览器的报错页。 */
function fromCache(req) {
  return caches.match(req, { ignoreSearch: true }).then(function (hit) {
    if (hit) return hit;
    if (req.mode === 'navigate') return caches.match('./index.html');
    return Response.error();
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  /* ignoreSearch 只在取缓存时用：带 ?v=… 之类参数的地址也能命中同一份 */
  e.respondWith(
    fetchFresh(req).catch(function () {
      return fromCache(req);
    })
  );
});
