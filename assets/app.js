
// 数据由 data/data.js（示例）或 data.local.js（本机构建）提供：window.SHIJU_DATA
// 复核数据同上：window.SHIJU_REVIEW

(function(){
'use strict';

/* ================= 基础 ================= */
var DATA=null, M=null;
/* 手机上导入的个人数据包（存 IndexedDB）。为 null 表示当前用的是页面内置数据 */
var PACK=null;
var byBook={}, byCat={}, byId={};
var NOTES=loadJSON('shiju.notes.v1',{});
var SEEN=loadJSON('shiju.seen.v1',{});
var RST=loadJSON('shiju.roam.v1',{});
var ALT={date:'',n:0,ids:[]};
var RV=null,DECIDE={},RVF={f:'todo',sec:'all',per:30,page:1};
/* 复核台的当前选中卡片（存qid，重渲染后据此恢复高亮） */
var RVC=null;
var STATE={view:'home',ci:null,book:null,bookQ:'',noteQ:'',altN:0};
var SCHED_DAILY=null, SCHED_ALT=null;
var EPOCH=new Date(2020,0,1);

function $(id){return document.getElementById(id);}
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
function escML(s){return esc(s).replace(/\n/g,'<br>');}
function loadJSON(k,fb){try{var v=localStorage.getItem(k);return v?JSON.parse(v):fb;}catch(e){return fb;}}
function saveJSON(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch(e){}}
function todayStr(){var d=new Date();return d.getFullYear()+'-'+p2(d.getMonth()+1)+'-'+p2(d.getDate());}
function p2(n){return n<10?'0'+n:''+n;}
function dseed(a,b){var s=a+'|'+b,h=5381;for(var i=0;i<s.length;i++){h=((h<<5)+h+s.charCodeAt(i))>>>0;}return h>>>0;}
function mulberry32(a){return function(){a|=0;a=(a+0x6D2B79F5)|0;var t=Math.imul(a^(a>>>15),1|a);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296;};}
function dayIndex(){var d=new Date();var mid=new Date(d.getFullYear(),d.getMonth(),d.getDate());return Math.max(0,Math.round((mid-EPOCH)/86400000));}
function toast(msg){var t=$('toast');t.textContent=msg;t.classList.add('show');clearTimeout(t._h);t._h=setTimeout(function(){t.classList.remove('show');},2200);}
function hashId(book,loc,occ){return 'q'+dseed(book+'\u241F'+(occ||0),loc).toString(36);}
function catIdx(cid){for(var i=0;i<DATA.cats.length;i++){if(DATA.cats[i].id===cid)return i;}return 0;}
var REDUCED=false;
try{if(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches)REDUCED=true;}catch(e){}

/* ================= 页面底色 =================
   四套配色与 share.js 的分享图完全一致（同一组色值）。
   实现方式是给 <html> 挂 data-skin，CSS 里用变量覆盖；
   存localStorage 记住选择。注意要在首次渲染前应用，否则会闪一下白。 */
var SKINS=[['paper','宣纸'],['night','夜墨'],['celadon','青瓷'],['cinnabar','朱砂']];
function skinApply(k){
  if(SKINS.every(function(s){return s[0]!==k;}))k='paper';
  document.documentElement.setAttribute('data-skin',k);
  var box=$('skins');
  if(box)Array.prototype.forEach.call(box.querySelectorAll('.skin'),function(b){
    b.classList.toggle('on',b.getAttribute('data-k')===k);
  });
}
function skinInit(){skinApply(loadJSON('shiju.skin.v1','paper'));}

/* ================= 初始化 ================= */
/* 数据内容指纹：用于判断「本机数据包」与「页面内置数据」是否为同一份内容。
   不能比较对象引用——两者来自不同途径（IndexedDB 反序列化 vs 直接赋值），
   内容相同也不是同一个对象。指纹只在数据真的变了时才让启动流程重跑 init。 */
function dataFingerprint(d){
  if(!d||!d.entries)return '';
  var h=5381,i;
  var push=function(s){
    for(var k=0;k<s.length;k++){h=((h<<5)+h+s.charCodeAt(k))>>>0;}
  };
  push('n:'+d.entries.length);
  push('c:'+((d.cats||[]).map(function(c){return c.id+c.count;}).join(',')));
  for(i=0;i<d.entries.length;i++){
    var e=d.entries[i];
    push('|'+e.book+'\u241F'+e.loc+'\u241F'+e.cat);
  }
  return String(h>>>0)+'-'+d.entries.length;
}

function init(d){
  /* 幂等保护（2026-10-12）：init 可能被启动流程的不同分支各调一次，
     若直接往 byBook/byCat/byId 里 push，会把同一批 entries 填两遍，
     渲染时同一条摘录就出现两次（只收录 1 条的书最容易被看出来）。
     这里先把派生表清空，保证无论调用几次，结果都等于「只初始化一次」。 */
  byBook={}; byCat={}; byId={};
  DATA=d; M=d.meta;
  var occCounter={};
  DATA.entries.forEach(function(e){
    var ok=e.book+'\u241F'+e.loc;
    occCounter[ok]=occCounter[ok]||0;
    e.occ=occCounter[ok];occCounter[ok]++;
    e.id=hashId(e.book,e.loc,e.occ);
    e.ci=catIdx(e.cat);
    (byBook[e.book]=byBook[e.book]||[]).push(e);
    (byCat[e.cat]=byCat[e.cat]||[]).push(e);
    byId[e.id]=e;
  });
  /* 全库位次（1 起）：分享图右下角的下标编号，也是「第 N 句」这类说法的来源。 */
  DATA.entries.forEach(function(e,i){e.gi=i;});
  /* 同一本书内部的顺序：按「入录顺序」排（seq 由构建脚本从《书籍阅读笔记》读出，1 起）。
     索引 md 是按分类写的，跨类拼接后你笔记里的先后就丢了（表现为同一本书章号忽前忽后），
     这里用 seq 还原。seq 缺失（旧数据、示例集未带、或原文没对上）时保持原顺序不动，
     行为与旧版一致 —— 所以只有当这本书每一条都有 seq 才排序。 */
  Object.keys(byBook).forEach(function(b){
    var arr=byBook[b];
    var allSeq=arr.every(function(e){return typeof e.seq==='number'&&e.seq>=0;});
    if(allSeq){arr.sort(function(x,y){return x.seq-y.seq;});}
    arr.forEach(function(e,i){e.bi=i;});
    arr.bySeqOrder=allSeq;
  });
  DATA.cats.forEach(function(c,ci){(byCat[c.id]||[]).forEach(function(e,i){e.gi=i;});});

  SCHED_DAILY=weightedSchedule('daily-v1');
  SCHED_ALT=weightedSchedule('alt-v1');
  var t=todayStr();
  ALT=loadJSON('shiju.alt.v1',{date:t,n:0,ids:[]});
  if(ALT.date!==t){ALT={date:t,n:0,ids:[]};}
  rvInit();
}

/* 作者查询：佚名是构建层占位符，展示时跳过 */
function authorOf(b){
  var a=DATA&&DATA.authors?DATA.authors[b]:null;
  return (a&&a!=='佚名')?a:'';
}
/* 作者展示：把「[德]」这类国家标识单独包一层 span，
   仅对网页视图生效——等宽字体里方括号、半角圆括号的下探比汉字深，
   只把这两个括号包进 .brk 上提一点点（见 style.css），标识里的汉字留在基线上，
   这样括号底沿与作者名齐平，汉字也不悬空。
   全角「（日）」的括号本身不下探（实测底沿还比汉字高），不加 .brk。
   数据保持原样，分享图仍用 authorOf 原文。 */
function authorHTML(a){
  if(!a)return '';
  var m=/^\s*（?[\[(（][^\]）)]{1,4}[\]）)]\s*/.exec(a);
  if(!m)return esc(a);
  var nat=m[0].trim(), rest=a.slice(m[0].length);
  var lift=/^[\[(]/.test(nat);   /* 西文方括号 / 半角圆括号才需要上提 */
  var bk=function(ch){return lift?'<span class="brk">'+esc(ch)+'</span>':esc(ch);};
  return '<span class="nat">'+bk(nat.charAt(0))+esc(nat.slice(1,-1))+bk(nat.charAt(nat.length-1))+'</span> '+(rest?esc(rest):'');
}

function rvInit(){
  RV=(window.SHIJU_REVIEW&&window.SHIJU_REVIEW.items)?window.SHIJU_REVIEW:{meta:{total:0,pending:0,kept:0,moved:0},items:[]};
  DECIDE=loadJSON('shiju.decide.v1',{});
  var map={};
  RV.items.forEach(function(it){map[it.qid]=it;});
  var pruned=false;
  Object.keys(DECIDE).forEach(function(q){
    if(!map[q]||map[q].status!=='待复核'){delete DECIDE[q];pruned=true;}
  });
  if(pruned)saveJSON('shiju.decide.v1',DECIDE);
}
function catName(cid){var c=DATA.cats[catIdx(cid)];return c?c.name:cid;}
/* 分类短名：去掉「·」后半段，用于窄空间展示（人生感悟·哲理 → 人生感悟） */
function shortCat(name){
  var s=String(name||'').split('·')[0].trim();
  return s.length>5?s.slice(0,5):(s||name);
}
function rvNow(){return new Date().toISOString().slice(0,10);}

/* 加权随机洗牌（A-Res）：同一数据版本下全设备一致 */
function catWeight(ci){
  var c=DATA.cats[ci], avg=M.total/DATA.cats.length;
  var w=avg/c.count;
  if(w<0.8)w=0.8; if(w>2.5)w=2.5;
  return w;
}
function weightedSchedule(salt){
  var rng=mulberry32(dseed('shiju-schedule',salt));
  var keys=DATA.entries.map(function(e,i){return {i:i,k:Math.pow(rng(),1/catWeight(e.ci))};});
  keys.sort(function(a,b){return b.k-a.k;});
  var arr=keys.map(function(k){return DATA.entries[k.i];});
  for(var i=1;i<arr.length;i++){
    if(arr[i].book===arr[i-1].book){
      var j=i+1;while(j<arr.length&&arr[j].book===arr[i].book)j++;
      if(j<arr.length){var t=arr[i];arr[i]=arr[j];arr[j]=t;}
    }
  }
  return arr;
}
function dailyEntry(){return SCHED_DAILY[dayIndex()%SCHED_DAILY.length];}

/* ================= 手记 ================= */
function notesOf(id){var r=NOTES[id];return r?r.notes:[];}
function noteCount(){var n=0;Object.keys(NOTES).forEach(function(k){n+=NOTES[k].notes.length;});return n;}
function saveNote(id,text){
  var e=byId[id];
  if(!NOTES[id]){NOTES[id]={book:e.book,loc:e.loc,cat:e.cat,occ:e.occ,notes:[]};}
  NOTES[id].notes.push({t:text,at:new Date().toISOString().slice(0,16).replace('T',' ')});
  saveJSON('shiju.notes.v1',NOTES);
}
function markSeen(e){
  var t=todayStr(),r=SEEN[e.id];
  if(r&&r.d===t){r.n++;}
  else{SEEN[e.id]={d:t,n:1};}
  saveJSON('shiju.seen.v1',SEEN);
}

/* ================= 视图 ================= */
var $view=$('view');

function setNav(v){['home','roam','notes','review','books'].forEach(function(k){$('nav-'+k).classList.toggle('on',k===v);});}

function playViewAnim(){
  $view.classList.remove('view-anim');
  void $view.offsetWidth;
  $view.classList.add('view-anim');
}
function openView(v,arg){
  STATE.view=v;
  if(v==='home'){renderHome();}
  else if(v==='roam'){STATE.ci=(typeof arg==='number')?arg:STATE.ci;renderRoam();}
  else if(v==='notes'){renderNotes();}
  else if(v==='books'){renderBooks();}
  else if(v==='review'){renderReview();}
  setNav(v);
  $view.classList.remove('wide');
  playViewAnim();
  window.scrollTo({top:0});
}

/* ---- 今日 ---- */
function renderHome(){
  var e=dailyEntry();
  markSeen(e);
  var notes=notesOf(e.id);
  var html='<div class="kick">今日拾句 · <b>'+esc(todayStr())+'</b> · 第 '+(dayIndex()%SCHED_DAILY.length+1)+' / '+SCHED_DAILY.length+' 句</div>';
  html+='<p class="daily-text">'+escML(e.text)+'</p>';
  html+='<p class="daily-meta"><span class="cat">'+esc(DATA.cats[e.ci].id+' '+DATA.cats[e.ci].name)+'</span> · '+(function(){var a=authorHTML(authorOf(e.book));return a?a+' · ':'';})()+'《'+esc(e.book)+'》 · '+esc(e.loc)+'</p>';
  if(notes.length){
    html+='<div class="ex-notes">';
    notes.forEach(function(n){html+='<div class="n-item"><div class="n-text">'+escML(n.t)+'</div><div class="n-date">'+esc(n.at)+'</div></div>';});
    html+='</div>';
  }
  html+='<div class="rule"></div>';
  html+='<div class="daily-actions">'
      +'<button class="btn" data-act="alt">换一条</button>'
      +'<button class="btn primary" data-act="note-open" data-id="'+e.id+'">写一句</button>'
      +'<button class="btn ghost" data-act="goto-cat" data-ci="'+e.ci+'">进入「'+esc(DATA.cats[e.ci].name)+'」</button>'
      +'<button class="btn ghost share-btn" data-act="share" data-id="'+e.id+'">分享好句</button>'
      +'</div>';
  var anniv=anniversaries();
  if(anniv.length){
    html+='<div class="anniv"><div class="a-kick">往年的今天</div>';
    anniv.forEach(function(a){
      html+='<div class="a-item"><div class="a-note">「'+escML(a.t)+'」</div>'
          +'<div class="a-src">'+esc(a.at.slice(0,4))+' · 《'+esc(a.book)+'》 · '+esc(a.loc)
          +'　<button data-act="goto-entry" data-id="'+a.id+'">回看原句</button></div></div>';
    });
    html+='</div>';
  }
  $view.innerHTML=html;
  revealView();
}
function anniversaries(){
  var t=todayStr(),md=t.slice(5),yr=t.slice(0,4),out=[];
  Object.keys(NOTES).forEach(function(id){
    var r=NOTES[id];
    r.notes.forEach(function(n){
      if(n.at.slice(5,10)===md&&n.at.slice(0,4)!==yr){out.push({id:id,book:r.book,loc:r.loc,t:n.t,at:n.at});}
    });
  });
  out.sort(function(a,b){return a.at<b.at?1:-1;});
  return out.slice(0,2);
}
/* 换一条：独立副排程，确定性推进 */
function renderAlt(){
  var daily=dailyEntry(),pick=null;
  for(var k=ALT.n;k<ALT.n+400;k++){
    var c=SCHED_ALT[k%SCHED_ALT.length];
    if(c.id!==daily.id&&ALT.ids.indexOf(c.id)<0){pick=c;ALT.n=k+1;break;}
  }
  if(!pick){ALT.ids=[];pick=SCHED_ALT[ALT.n%SCHED_ALT.length];ALT.n++;}
  ALT.ids.push(pick.id);
  saveJSON('shiju.alt.v1',ALT);
  markSeen(pick);
  var notes=notesOf(pick.id);
  var html='<div class="kick">拾句 · 换一条 · <b>'+esc(todayStr())+'</b></div>';
  html+='<p class="daily-text">'+escML(pick.text)+'</p>';
  html+='<p class="daily-meta"><span class="cat">'+esc(DATA.cats[pick.ci].id+' '+DATA.cats[pick.ci].name)+'</span> · '+(function(){var a=authorHTML(authorOf(pick.book));return a?a+' · ':'';})()+'《'+esc(pick.book)+'》 · '+esc(pick.loc)+'</p>';
  if(notes.length){
    html+='<div class="ex-notes">';
    notes.forEach(function(n){html+='<div class="n-item"><div class="n-text">'+escML(n.t)+'</div><div class="n-date">'+esc(n.at)+'</div></div>';});
    html+='</div>';
  }
  html+='<div class="rule"></div>';
  html+='<div class="daily-actions">'
      +'<button class="btn" data-act="alt">再换一条</button>'
      +'<button class="btn primary" data-act="note-open" data-id="'+pick.id+'">写一句</button>'
      +'<button class="btn ghost share-btn" data-act="share" data-id="'+pick.id+'">分享好句</button>'
      +'<button class="btn ghost" data-act="nav" data-v="home">回到今日</button>'
      +'</div>';
  $view.classList.remove('wide');
  $view.innerHTML=html;
  revealView();
}

/* ---- 漫游 ---- */
function renderRoam(){
  var html='<h2 class="view-title rv-fade">心境漫游</h2>'
      +'<p class="view-sub rv-fade" style="--d:1">十个气质分区，按此刻的心情进入。</p><div class="shelf">';
  var max=0;
  DATA.cats.forEach(function(c){if(c.count>max)max=c.count;});
  DATA.cats.forEach(function(c,ci){
    var nc=0;byCat[c.id].forEach(function(e){nc+=notesOf(e.id).length;});
    var rst=RST[c.id],readPct=rst?Math.min(100,Math.round((rst.gi+1)/byCat[c.id].length*100)):0;
    html+='<div class="cat-card rv" style="--d:'+ci+'" data-act="goto-cat" data-ci="'+ci+'">'
        +'<div class="cc-no"><span>'+esc(c.id)+'</span><span>'+(rst&&rst.gi>0?'读到 '+readPct+'%':'')+'</span></div>'
        +'<div class="cc-name">'+esc(c.name)+'</div>'
        +'<div class="cc-std">'+esc(c.std)+'</div>'
        +'<div class="cc-stats"><b>'+c.count+'</b> 条 · <b>'+c.books+'</b> 本书'+(nc?' · 手记 <b>'+nc+'</b>':'')+'</div>'
        +'<div class="cc-bar"><i style="width:'+(c.count/max*100).toFixed(1)+'%"></i></div>'
        +'</div>';
  });
  html+='</div>';
  $view.innerHTML=html;
  revealView();
}

/* ---- 摘录流 ---- */
function openCat(ci,gi){
  STATE.ci=ci;STATE.view='cat';setNav('roam');
  renderCat(ci,gi||0);
  playViewAnim();
  window.scrollTo({top:0});
}
function renderCat(ci,gi){
  var c=DATA.cats[ci],entries=byCat[c.id]||[];
  if(gi>0){RST[c.id]={gi:gi};saveJSON('shiju.roam.v1',RST);}
  var rst=RST[c.id];
  /* 本区书目录（左侧栏） */
  var books=[],seen={};
  entries.forEach(function(e){
    if(seen[e.book]==null){seen[e.book]=books.length;books.push({name:e.book,n:0});}
    books[seen[e.book]].n++;
  });
  var toc='<aside class="cat-toc"><div class="cat-toc-kick">本区书目 · '+books.length+' 本</div>';
  books.forEach(function(b,k){
    toc+='<button class="toc-item" data-act="toc-book" data-bk="'+k+'" title="跳到《'+esc(b.name)+'》"><span class="tn">'+esc(b.name)+'</span><span class="tc">'+b.n+'</span></button>';
  });
  toc+='</aside>';
  var html='';
  if(rst&&rst.gi>0&&gi===0){
    html+='<div class="resume"><span>上次读到《'+esc(entries[rst.gi].book)+'》附近（'+rst.gi+' / '+entries.length+'）</span>'
        +'<span><button class="btn" data-act="resume" data-ci="'+ci+'">续读</button>　<button class="btn ghost" data-act="reset-cat" data-ci="'+ci+'">从头</button></span></div>';
  }
  /* 先按书分组，组内按「入录顺序」排（seq），与书目单书视图保持同一种顺序。
     分类索引 md 里同一本书的条目本来就是笔记顺序，排序只是把个别错位也一并扶正；
     书内 seq 不全时保持原顺序不动（旧数据的行为）。 */
  var groups=[];
  entries.forEach(function(e){
    if(!groups.length||groups[groups.length-1].book!==e.book)groups.push({book:e.book,items:[]});
    groups[groups.length-1].items.push(e);
  });
  groups.forEach(function(g){
    if(g.items.every(function(e){return typeof e.seq==='number'&&e.seq>=0;})){
      g.items.sort(function(x,y){return x.seq-y.seq;});
    }
  });
  var bk=-1;
  groups.forEach(function(g){
    bk++;
    html+='<div class="book-group" data-bk="'+bk+'"><h3>《'+esc(g.book)+'》<span class="bg-count">'+(g.items[0].bi+1)+' / '+byBook[g.book].length+'</span></h3>';
    g.items.forEach(function(e){
      var notes=notesOf(e.id);
      html+='<div class="ex" data-eid="'+e.id+'"><p class="ex-text">'+escML(e.text)+'</p>'
          +'<p class="ex-meta"><span class="loc">'+esc(e.loc)+'</span>'
          +'<button class="addnote" data-act="note-open" data-id="'+e.id+'">'+(notes.length?'手记 '+notes.length+' · 添加':'写一句')+'</button>'
          +'<button class="addnote share-mini" data-act="share" data-id="'+e.id+'" title="存为图片">分享</button></p>';
      if(notes.length){
        html+='<div class="ex-notes">';
        notes.forEach(function(n){html+='<div class="n-item"><div class="n-text">'+escML(n.t)+'</div><div class="n-date">'+esc(n.at)+'</div></div>';});
        html+='</div>';
      }
      html+='</div>';
    });
    html+='</div>';
  });
  html+='<div class="stream-end">· 本区终 · '+entries.length+' 条 ·</div>';
  html+='<div class="progress-line" id="progLine"></div>';
  $view.classList.add('wide');
  $view.innerHTML='<div class="crumb"><button data-act="nav" data-v="roam">漫游</button> / '+esc(c.id)+' '+esc(c.name)+'</div>'
      +'<div class="cat-layout">'+toc+'<div class="cat-main">'+html+'</div></div>';
  revealView();
  updateProg(ci);
  updateToc();
  var tgt=null;
  if(gi>0){tgt=$view.querySelector('[data-eid="'+entries[gi].id+'"]');}
  else if(rst&&rst.gi>0){tgt=$view.querySelector('[data-eid="'+entries[rst.gi].id+'"]');if(tgt)tgt.classList.add('flash');}
  if(tgt){setTimeout(function(){tgt.scrollIntoView({block:'center'});},40);}
}
/* 高亮侧栏中当前读到的书 */
function updateToc(){
  var toc=$view.querySelector('.cat-toc');
  if(!toc)return;
  var groups=$view.querySelectorAll('.book-group'),cur=null;
  groups.forEach(function(g){
    if(g.getBoundingClientRect().top<=96)cur=g.getAttribute('data-bk');
  });
  if(cur==null&&groups.length)cur=groups[0].getAttribute('data-bk');
  toc.querySelectorAll('.toc-item').forEach(function(it){
    it.classList.toggle('on',it.getAttribute('data-bk')===cur);
  });
}
function updateProg(ci){
  var c=DATA.cats[ci],entries=byCat[c.id]||[],line=$('progLine');
  if(!line)return;
  var mid=Math.floor(window.scrollY+window.innerHeight/2),best=0;
  $view.querySelectorAll('.ex').forEach(function(el){
    if(el.offsetTop<=mid)best++;
  });
  line.textContent='已阅 '+best+' / '+entries.length+' 条';
  if(best>0){RST[c.id]={gi:Math.min(best,entries.length-1)};saveJSON('shiju.roam.v1',RST);}
}

/* ---- 手记流 ---- */
function renderNotes(){
  var q=STATE.noteQ.trim().toLowerCase();
  var rows=[];
  Object.keys(NOTES).forEach(function(id){
    var r=NOTES[id];
    r.notes.forEach(function(n,i){rows.push({id:id,book:r.book,loc:r.loc,cat:r.cat,t:n.t,at:n.at,i:i});});
  });
  rows.sort(function(a,b){return a.at<b.at?1:-1;});
  if(q){rows=rows.filter(function(r){return r.t.toLowerCase().indexOf(q)>=0||r.book.toLowerCase().indexOf(q)>=0;});}
  var html='<h2 class="view-title">手记</h2>'
      +'<p class="view-sub">你写在句子旁边的想法，按时间倒序。共 '+rows.length+' 则。</p>'
      +'<input class="search" id="noteQ" placeholder="筛选手记或原句……" value="'+esc(STATE.noteQ)+'">';
  if(!rows.length){
    html+='<div class="empty">'+(q?'没有匹配的手记。':'还没有手记——在今日或漫游里，遇到有感触的句子，点「写一句」。')+'</div>';
  }
  var curDay='';
  rows.forEach(function(r){
    var day=r.at.slice(0,10);
    if(day!==curDay){curDay=day;html+='<div class="crumb" style="margin:34px 0 0">'+esc(day)+'</div>';}
    html+='<div class="note-block">'
        +'<div class="nb-note">'+escML(r.t)+'</div>'
        +'<div class="nb-quote">'+escML(byId[r.id]?byId[r.id].text:r._t||'（原句不在当前数据中）')+'</div>'
        +'<div class="nb-src">《'+esc(r.book)+'》 · '+esc(r.loc)+' · '+esc(r.cat)+'</div>'
        +'<div class="nb-date"><button data-act="goto-entry" data-id="'+r.id+'">回看原句 →</button></div>'
        +'</div>';
  });
  $view.innerHTML=html;
  revealView();
  var inp=$('noteQ');
  if(inp){inp.addEventListener('input',function(){STATE.noteQ=inp.value;renderNotesKeepFocus();});}
}
function renderNotesKeepFocus(){
  var pos=null,inp=$('noteQ');
  if(inp){pos=inp.selectionStart;}
  renderNotes();
  inp=$('noteQ');
  if(inp&&pos!=null){inp.focus();try{inp.setSelectionRange(pos,pos);}catch(e){}}
}

/* ---- 书目 ---- */
/* 卡片上那行分区分布：卡片宽度有限，十个区用全名会撑成三四行，所以用两字简称。
   按索引里的分区编号（01–10）一一对应；改了索引里的分区名，记得回来一起改。
   对不上的编号退回「取全名里最后一个词，仍超两字就取前两字」，绝不因为漏配而报错。 */
var CAT_SHORT={'01':'哲理','02':'处世','03':'情欲','04':'感伤','05':'毒舌',
               '06':'豪情','07':'苦难','08':'诗意','09':'思辨','10':'温情'};
function catShortOf(id){
  if(CAT_SHORT[id])return CAT_SHORT[id];
  var cs=DATA.cats,name='';
  for(var i=0;i<cs.length;i++){if(cs[i].id===id){name=cs[i].name;break;}}
  var t=name.split('·').pop();
  if(!t)return id;
  return t.length<=2?t:t.slice(0,2);
}
function renderBooks(){
  var q=STATE.bookQ.trim().toLowerCase();
  var names=Object.keys(byBook).sort(function(a,b){return byBook[b].length-byBook[a].length;});
  var list=names;
  if(q){
    list=names.filter(function(b){
      return b.toLowerCase().indexOf(q)>=0||byBook[b].some(function(e){return e.text.toLowerCase().indexOf(q)>=0;});
    });
  }
  var html='<h2 class="view-title">书目</h2>'
      +'<p class="view-sub">'+Object.keys(byBook).length+' 本书的摘录全景。检索兜底：按书名或摘录内容查找。</p>'
      +'<input class="search" id="bookQ" placeholder="搜书名，或搜任意一句原文……" value="'+esc(STATE.bookQ)+'">';
  if(!list.length){html+='<div class="empty">没有匹配的书。</div>';}
  html+='<div class="books-grid">';
  list.forEach(function(b){
    var es=byBook[b],catMap={};
    es.forEach(function(e){catMap[e.cat]=(catMap[e.cat]||0)+1;});
    var chips=Object.keys(catMap).sort().map(function(c){return catShortOf(c)+' '+catMap[c];}).join(' · ');
    var nc=0;es.forEach(function(e){nc+=notesOf(e.id).length;});
    html+='<div class="bk-card" data-act="open-book" data-book="'+esc(b)+'">'
        +'<div class="bk-name">《'+esc(b)+'》</div>'
        +'<div class="bk-stats"><b>'+es.length+'</b> 条'+(nc?' · 手记 <b>'+nc+'</b>':'')+'</div>'
        +'<div class="bk-cats">'+esc(chips)+'</div>'
        +'</div>';
  });
  html+='</div>';
  $view.innerHTML=html;
  revealView();
  var inp=$('bookQ');
  if(inp){inp.addEventListener('input',function(){STATE.bookQ=inp.value;renderBooksKeepFocus();});}
}
function renderBooksKeepFocus(){
  var pos=null,inp=$('bookQ');
  if(inp){pos=inp.selectionStart;}
  renderBooks();
  inp=$('bookQ');
  if(inp&&pos!=null){inp.focus();try{inp.setSelectionRange(pos,pos);}catch(e){}}
}
/* 视图内滚动显现：给 .rv 元素排上延迟序号 */
function revealView(){
  if(REDUCED)return;
  $view.querySelectorAll('.rv').forEach(function(el,i){el.style.setProperty('--d',Math.min(i+2,11));});
}

/* ---- 单书视图 ---- */
function openBook(b){
  STATE.book=b;STATE.view='book';setNav('books');
  var es=byBook[b],html='<div class="crumb"><button data-act="nav" data-v="books">书目</button> / 《'+esc(b)+'》</div>'
      +'<h2 class="view-title rv-fade" style="font-size:24px">《'+esc(b)+'》</h2>'
      /* 副标题说实话：能按《书籍阅读笔记》对齐的书才是「入录顺序」，
         对不齐的（旧数据、原文有改动）仍旧是按分类归集后拼接的顺序 */
      +'<p class="view-sub rv-fade" style="--d:1">'+es.length+' 条摘录，'
      +(es.bySeqOrder?'按入录顺序。':'按分类归集，类内按入录顺序。')+'</p>';
  es.forEach(function(e){
    var notes=notesOf(e.id);
    html+='<div class="ex" data-eid="'+e.id+'"><p class="ex-text">'+escML(e.text)+'</p>'
        +'<p class="ex-meta"><span class="loc">'+esc(e.loc)+'</span><span class="cat-chip">'+esc(e.cat)+' '+esc(DATA.cats[e.ci].name)+'</span>'
        +'<button class="addnote" data-act="note-open" data-id="'+e.id+'">'+(notes.length?'手记 '+notes.length+' · 添加':'写一句')+'</button>'
        +'<button class="addnote share-mini" data-act="share" data-id="'+e.id+'" title="存为图片">分享</button></p>';
    if(notes.length){
      html+='<div class="ex-notes">';
      notes.forEach(function(n){html+='<div class="n-item"><div class="n-text">'+escML(n.t)+'</div><div class="n-date">'+esc(n.at)+'</div></div>';});
      html+='</div>';
    }
    html+='</div>';
  });
  $view.classList.remove('wide');
  $view.innerHTML=html;
  revealView();
  playViewAnim();
  window.scrollTo({top:0});
}

/* ---- 复核台 ---- */
function rvQueue(){
  var order=loadJSON('shiju.rv.order.v1',null);
  var items=RV.items||[];
  if(!order||!order.length){order=items.map(function(it){return it.qid;});}
  items.forEach(function(it){if(order.indexOf(it.qid)<0)order.push(it.qid);});
  order=order.filter(function(q){return items.some(function(it){return it.qid===q;});});
  saveJSON('shiju.rv.order.v1',order);
  var map={};items.forEach(function(it){map[it.qid]=it;});
  return order.map(function(q){return map[q];}).filter(Boolean);
}
function rvSaveDecide(){saveJSON('shiju.decide.v1',DECIDE);}
/* 当前可见卡片在 $view 里的下标 —— 键盘上下切换靠它定位 */
function rvCards(){
  return Array.prototype.slice.call($view.querySelectorAll('.rv-card'));
}
function rvCardEls(){
  return Array.prototype.slice.call($view.querySelectorAll('.rv-card:not(.done)'));
}
/* 把高亮挪到第 n 张未拍板卡（clamp 到范围内），并滚进视野 */
function rvFocus(n,scroll){
  var els=rvCardEls();
  if(!els.length){RVC=null;return;}
  var i=els.findIndex(function(el){return el.getAttribute('data-qid')===RVC;});
  if(i<0)i=0;
  i=Math.max(0,Math.min(els.length-1,i+n));
  RVC=els[i].getAttribute('data-qid');
  rvPaint();
  if(scroll!==false)els[i].scrollIntoView({block:'center',behavior:'smooth'});
}
/* 只切高亮，不重渲染（点卡片时用，避免闪烁与滚动位置丢失） */
function rvPaint(){
  rvCardEls().forEach(function(el){
    el.classList.toggle('cur',el.getAttribute('data-qid')===RVC);
  });
}
/* 翻页；d 为+1/-1。翻页后 RVC 若不在新页，renderReview 会自动落到本页首张待拍板卡 */
function rvGoPage(d){
  RVF.page+=d;
  if(RVF.page<1)RVF.page=1;
  renderReview();
  window.scrollTo({top:0,behavior:REDUCED?'auto':'smooth'});
}
function renderReview(){
  var q=rvQueue();
  var items=RV.items||[];
  var pendingTotal=items.filter(function(it){return it.status==='待复核';}).length;
  var decided=items.filter(function(it){return it.status==='待复核'&&DECIDE[it.qid];}).length;
  var html='<h2 class="view-title">复核台</h2>'
      +'<p class="view-sub">《拿不准就近归类清单》的悬置条目，在这里翻卡拍板。拍板只生成本机记录，不改动任何 md——导出后运行 应用复核.ps1 回写。</p>'
      +'<div class="rv-stats">清单共 <b>'+items.length+'</b> 条 · 待拍板 <b>'+(pendingTotal-decided)+'</b> · 已拍板待回写 <b>'+decided+'</b> · 历史已定（保留 '+RV.meta.kept+' · 移入 '+RV.meta.moved+'）</div>'
      +'<div class="rv-exportrow"><button class="btn'+(decided?' primary':' ghost')+'" data-act="rv-export">导出拍板记录（'+decided+' 条）</button></div>';

  /* 可见集合：先按分区筛，再按状态筛 */
  var pool=q.filter(function(it){return RVF.sec==='all'||it.sec===RVF.sec;});
  var vis=pool.filter(function(it){
    if(RVF.f==='todo')return it.status==='待复核'&&!DECIDE[it.qid];
    if(RVF.f==='done')return (it.status==='待复核'&&!!DECIDE[it.qid])||it.status!=='待复核';
    return true;
  });
  var inF=function(it,p){
    if(p==='todo')return it.status==='待复核'&&!DECIDE[it.qid];
    if(p==='done')return (it.status==='待复核'&&!!DECIDE[it.qid])||it.status!=='待复核';
    return true;
  };
  var fCount=function(p){return pool.filter(function(it){return inF(it,p);}).length;};
  var secCount=function(sid){
    return q.filter(function(it){return (sid==='all'||it.sec===sid)&&inF(it,RVF.f);}).length;
  };

  /* 筛选条：左「状态」分段控件 + 右「分区」带计数徽标的芯片 */
  var fv=pool.length;
  var fl='<div class="rv-bar" id="rvFilters">'
      +'<div class="rv-grp"><span class="rv-grp-k">状态</span><div class="rv-seg">';
  [['all','全部',fv],['todo','未拍板',fCount('todo')],['done','已定',fCount('done')]].forEach(function(p){
    fl+='<button data-act="rv-filter" data-f="'+p[0]+'" class="'+(RVF.f===p[0]?'on':'')+'"'
       +' aria-pressed="'+(RVF.f===p[0])+'">'+p[1]+'<i class="n">'+p[2]+'</i></button>';
  });
  fl+='</div></div><div class="rv-grp"><span class="rv-grp-k">分区</span><div class="rv-chips">';
  fl+='<button data-act="rv-filter" data-sec="all" class="'+(RVF.sec==='all'?'on':'')+'"'
     +' aria-pressed="'+(RVF.sec==='all')+'" title="全部分区">全部分区<i class="n">'+secCount('all')+'</i></button>';
  DATA.cats.forEach(function(c){
    var n=secCount(c.id);
    fl+='<button data-act="rv-filter" data-sec="'+c.id+'" class="'+(RVF.sec===c.id?'on ':'')+(n?'':'zero')
       +'" aria-pressed="'+(RVF.sec===c.id)+'" title="'+esc(c.name)+'：'+esc(c.std)+'">'
       +'<i class="id">'+c.id+'</i>'+esc(shortCat(c.name))+'<i class="n">'+n+'</i></button>';
  });
  fl+='</div></div></div>';
  html+=fl;
  if(!vis.length){
    html+='<div class="empty">'+(RVF.f==='todo'?'这一类已全部拍板。换一批，或导出记录去回写。':'没有匹配的条目。')+'</div>';
    RVC=null;
  }else{
    /* 翻页：每页 RVF.per 张，页码夹在有效范围内 */
    var pages=Math.max(1,Math.ceil(vis.length/RVF.per));
    if(RVF.page>pages)RVF.page=pages;
    if(RVF.page<1)RVF.page=1;
    var pageItems=vis.slice((RVF.page-1)*RVF.per,RVF.page*RVF.per);
    pageItems.forEach(function(it){html+=rvCard(it);});
    /* 选中项若被翻页甩掉，自动落到本页第一张待拍板卡 */
    var onPage=pageItems.some(function(it){return it.qid===RVC;});
    if(!onPage){
      var firstTodo=null;
      for(var i=0;i<pageItems.length;i++){
        if(pageItems[i].status==='待复核'&&!DECIDE[pageItems[i].qid]){firstTodo=pageItems[i].qid;break;}
      }
      RVC=firstTodo||null;
    }
    html+=rvPager(vis.length,pages);
  }
  html+='<div class="rv-hint" style="margin:6px 0 30px">键盘：'
    +'<kbd>↑</kbd><kbd>↓</kbd> 切换卡片 · <kbd>←</kbd><kbd>→</kbd> 翻页 · '
    +'<kbd>小键盘1</kbd> 保留现类 · <kbd>小键盘2</kbd> 移入另一类 · <kbd>空格</kbd> 跳过 —— 均作用于高亮的那张卡</div>';
  $view.innerHTML=html;
  rvPaint();
  revealView();
}
/* 翻页条：只在超过一页时出现 */
function rvPager(total,pages){
  if(pages<2)return '';
  var p=RVF.page;
  return '<div class="rv-pager">'
    +'<button class="btn ghost" data-act="rv-page" data-d="-1"'+(p<=1?' disabled':'')+'>← 上一页</button>'
    +'<span class="rv-pg">第 <b>'+p+'</b> / '+pages+' 页 · 每页 '+RVF.per+' 张 · 共 '+total+' 条</span>'
    +'<button class="btn ghost" data-act="rv-page" data-d="1"'+(p>=pages?' disabled':'')+'>下一页 →</button>'
    +'</div>';
}
function rvCard(it){
  var d=DECIDE[it.qid];
  var done=(d||it.status!=='待复核');
  var h='<div class="rv-card'+(done?' done':'')+'" data-qid="'+it.qid+'">';  h+='<p class="rv-q">'+escML(it.text)+'</p>';
  h+='<div class="rv-meta">'+(function(){var a=authorHTML(authorOf(it.book));return a?a+' · ':'';})()+'《'+esc(it.book)+'》 · '+esc(it.loc)+' · <span class="cat">'+esc(it.sec+' '+catName(it.sec))+'</span></div>';
  if(it.reason&&it.reason!=='—'){
    h+='<div class="rv-why">'+esc(it.reason)+'</div>';
  }
  if(it.status==='保留'){
    h+='<div class="rv-chip">清单已定：保留于本类<span class="u"> · '+esc(it.date||'')+'</span></div>';
  }else if(it.status&&it.status.indexOf('移入←')===0){
    h+='<div class="rv-chip">清单已定：自 '+esc(it.status.replace('移入←',''))+' 移入<span class="u"> · '+esc(it.date||'')+'</span></div>';
  }else if(d){
    h+='<div class="rv-chip">你的拍板：'+(d.decision==='keep'?'保留现类':'移入 '+d.to+' '+esc(catName(d.to)))+'<span class="u"> · '+esc(d.at)+' · 待回写</span>　<button class="addnote" data-act="rv-undo" data-qid="'+it.qid+'">撤销</button></div>';
  }else{
    /* 按钮后标出这条摘录真实涉及的分类：
       保留现类 = 当前所在分类；移入另一类 = 该条在归零清单里登记的「备选」字段
       （可能是多个，用／分隔；登记为「—」的说明当时没留备选）。 */
    var alt=String(it.alt||'').trim();
    var altTxt=(!alt||alt==='—')?'未留备选':alt.split('／').map(function(s){return shortCat(s.trim());}).join('／');
    var otherCats=DATA.cats.length-1;
    h+='<div class="rv-acts">'
      +'<button class="btn" data-act="rv-keep" data-qid="'+it.qid+'"'
      +' title="保留在当前分类 '+esc(it.sec+' '+catName(it.sec))+'">'
      +'保留现类<kbd class="rv-k">1</kbd><span class="rv-acts-c">'+esc(shortCat(catName(it.sec)))+'</span></button>'
      +'<button class="btn" data-act="rv-move" data-qid="'+it.qid+'"'
      +' title="归零清单登记的备选：'+esc(altTxt)+'（点开可选全部 '+otherCats+' 类）">'
      +'移入另一类<kbd class="rv-k">2</kbd><span class="rv-acts-c">'+esc(altTxt)+'</span></button>'
      +'<button class="btn ghost" data-act="rv-skip" data-qid="'+it.qid+'">跳过<kbd class="rv-k">空格</kbd></button>'
      +'</div>';
    h+='<div class="rv-targets" id="tg-'+it.qid+'">';
    DATA.cats.forEach(function(c){
      if(c.id===it.sec)return;
      h+='<button data-act="rv-moveto" data-qid="'+it.qid+'" data-to="'+c.id+'">'+c.id+' '+esc(c.name)+'</button>';
    });
    h+='</div>';
  }
  h+='</div>';
  return h;
}
/* 拍板/跳过后高亮自动跟到「同一页的下一张待拍板卡」——
   没有它的话，键盘流会卡在原地：拍完这张变.done，RVC 还指着它，
   findIndex 找不到就退回第一张。做法是动手前先记下当前可见顺序。 */
function rvVisOrder(){
  return rvCards().map(function(el){return el.getAttribute('data-qid');});
}
function rvAdvance(acted,prevOrder){
  if(!prevOrder||!prevOrder.length){renderReview();return;}
  var i=prevOrder.indexOf(acted);
  var next=null;
  for(var k=i+1;k<prevOrder.length;k++){
    var q=prevOrder[k];
    var it=RV.items.filter(function(x){return x.qid===q;})[0];
    if(it&&it.status==='待复核'&&!DECIDE[q]){next=q;break;}
  }
  if(!next){
    for(var k2=0;k2<prevOrder.length;k2++){
      var q2=prevOrder[k2];
      var it2=RV.items.filter(function(x){return x.qid===q2;})[0];
      if(it2&&it2.status==='待复核'&&!DECIDE[q2]){next=q2;break;}
    }
  }
  renderReview();
  /* 下一张不在当前页（翻页边界）时，把高亮交回 renderReview 的兜底逻辑 */
  if(next){RVC=next;rvPaint();
    var el=$view.querySelector('.rv-card[data-qid="'+next+'"]');
    if(el)el.scrollIntoView({block:'center',behavior:REDUCED?'auto':'smooth'});
  }
}
function rvActKeep(qid){
  var it=RV.items.filter(function(x){return x.qid===qid;})[0];if(!it)return;
  var prev=rvVisOrder();
  DECIDE[qid]={decision:'keep',from:it.sec,to:it.sec,at:rvNow()};
  rvSaveDecide();rvAdvance(qid,prev);
}
function rvActMoveTo(qid,to){
  var it=RV.items.filter(function(x){return x.qid===qid;})[0];if(!it)return;
  var prev=rvVisOrder();
  DECIDE[qid]={decision:'move',from:it.sec,to:to,at:rvNow()};
  rvSaveDecide();rvAdvance(qid,prev);
}
function rvActSkip(qid){
  var prev=rvVisOrder();
  var order=loadJSON('shiju.rv.order.v1',null)||[];
  var i=order.indexOf(qid);
  if(i>=0){order.splice(i,1);order.push(qid);saveJSON('shiju.rv.order.v1',order);}
  rvAdvance(qid,prev);
}

/* ================= 弹层 ================= */
var pendingNoteId=null,wipeArmed=false,packWipeArmed=false;
function openNote(id){
  var e=byId[id];if(!e)return;
  pendingNoteId=id;
  $('npAnchor').innerHTML=escML(e.text)+'<span class="am">《'+esc(e.book)+'》 · '+esc(e.loc)+' · '+esc(DATA.cats[e.ci].name)+'</span>';
  $('npText').value='';
  $('noteOverlay').classList.add('open');
  setTimeout(function(){$('npText').focus();},60);
}
function closeNote(){$('noteOverlay').classList.remove('open');pendingNoteId=null;}
function openSettings(){
  wipeArmed=false;$('wipeBtn').textContent='清空';$('wipeBtn').style.borderColor='';$('wipeBtn').style.color='';
  packWipeArmed=false;$('packWipeBtn').textContent='清除';$('packWipeBtn').style.borderColor='';$('packWipeBtn').style.color='';
  $('setInfo').innerHTML=M
    ? ('数据版本：'+M.total+' 条 · '+M.books+' 本书 · '+DATA.cats.length+' 类<br>'
      +'构建时间：'+M.generated+'<br>'
      +'数据来源：'+(PACK?('本机数据包 · '+PACK.imported+' 导入'):'页面内置')+'<br>'
      +(SYNC?('云端同步：'+esc(SYNC.owner)+'/'+esc(SYNC.repo)+' · '
        +(SYNCST?(esc(SYNCST.msg)+'（'+esc(SYNCST.at)+'）'):'待首次检查')+'<br>'):'')
      +'手记：'+noteCount()+' 则（存于本机浏览器）')
    : '尚未载入摘录数据。可导入数据包，或在电脑上运行构建脚本后刷新本页。';
  var sc=$('syncCfg');if(sc)sc.value=SYNC?JSON.stringify({v:SYNC.v,owner:SYNC.owner,repo:SYNC.repo,branch:SYNC.branch,dir:SYNC.dir}):'';
  var st=$('syncToken');if(st)st.value=SYNC?(SYNC.token||''):'';
  $('setOverlay').classList.add('open');
}

/* ================= 事件路由 ================= */
/* 把分享图需要的只读能力交给 share.js：那边是独立作用域，取不到这里的局部变量。
   只暴露一个入口，具体取哪条由 share.js 自己按 id 决定。 */
function shareContext(id){
  var e=id&&byId[id]?byId[id]:dailyEntry();
  if(!e)return null;
  return {
    text:e.text,
    book:e.book,
    author:authorOf(e.book),
    loc:e.loc,
    cat:DATA.cats[e.ci].id+' '+shortCat(DATA.cats[e.ci].name),
    date:todayStr(),
    /* 角落的两处编号：上标 = 所属类别号，下标 = 本条在全库中的位次。
       都在这里取，share.js 只负责画，不回头碰数据层。 */
    catNo:DATA.cats[e.ci].id,
    no:padNo(e.gi+1)
  };
}
/* 序号左侧补零到索引的位数：3 位数据补成 040，1065 位则补成 1065——
   配合等宽字体，图上数字宽度恒定，不会因位次变化而左右跳动。 */
function padNo(n){
  var w=String(DATA.entries.length).length;
  var s=String(n);
  while(s.length<w)s='0'+s;
  return s;
}
window.SJIShareCtx=shareContext;

document.body.addEventListener('click',function(ev){
  var el=ev.target.closest('[data-act]');
  if(!el)return;
  var act=el.getAttribute('data-act');
  if(act==='nav'){openView(el.getAttribute('data-v'));}
  else if(act==='goto-cat'){openCat(parseInt(el.getAttribute('data-ci'),10),0);}
  else if(act==='goto-entry'){var e=byId[el.getAttribute('data-id')];if(e)openCat(e.ci,e.gi);}
  else if(act==='alt'){renderAlt();playViewAnim();window.scrollTo({top:0});}
  else if(act==='note-open'){openNote(el.getAttribute('data-id'));}
  else if(act==='np-cancel'){closeNote();}
  else if(act==='np-save'){
    var v=$('npText').value.trim();
    if(!v){$('npText').focus();return;}
    saveNote(pendingNoteId,v);
    closeNote();toast('已存入手记');
    if(STATE.view==='home'){renderHome();}
    else if(STATE.view==='cat'){renderCat(STATE.ci,0);var e2=byId[pendingNoteId];if(e2){var t=$view.querySelector('[data-eid="'+e2.id+'"]');if(t){t.classList.add('flash');setTimeout(function(){t.scrollIntoView({block:'center'});},40);}}}
    else if(STATE.view==='book'){openBook(STATE.book);}
    else if(STATE.view==='notes'){renderNotes();}
  }
  else if(act==='resume'){renderCat(parseInt(el.getAttribute('data-ci'),10),RST[DATA.cats[parseInt(el.getAttribute('data-ci'),10)].id].gi);}
  else if(act==='reset-cat'){var ci=parseInt(el.getAttribute('data-ci'),10);delete RST[DATA.cats[ci].id];saveJSON('shiju.roam.v1',RST);renderCat(ci,0);window.scrollTo({top:0});}
  else if(act==='open-book'){openBook(el.getAttribute('data-book'));}
  else if(act==='toc-book'){
    var g=$view.querySelector('.book-group[data-bk="'+el.getAttribute('data-bk')+'"]');
    if(g)g.scrollIntoView({block:'start',behavior:REDUCED?'auto':'smooth'});
  }
  else if(act==='totop'){window.scrollTo({top:0,behavior:REDUCED?'auto':'smooth'});}
  else if(act==='rv-export'){
    var rows=rvExportRows();
    if(!rows.length){toast('还没有拍板记录——先翻几张卡');return;}
    var blob=new Blob([JSON.stringify({app:'拾句',type:'review-decisions',exported:rvNow(),decisions:rows},null,2)],{type:'application/json'});
    var a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='拾句拍板-'+rvNow()+'.json';a.click();
    setTimeout(function(){URL.revokeObjectURL(a.href);},2000);
    toast('已导出 '+rows.length+' 条拍板记录');
  }
  else if(act==='rv-filter'){
    if(el.getAttribute('data-f')){RVF.f=el.getAttribute('data-f');}
    if(el.getAttribute('data-sec')){RVF.sec=el.getAttribute('data-sec');}
    RVF.page=1;renderReview();
  }
  else if(act==='rv-page'){rvGoPage(parseInt(el.getAttribute('data-d'),10));}
  else if(act==='rv-keep'){rvActKeep(el.getAttribute('data-qid'));}
  else if(act==='rv-move'){
    var tg=$('tg-'+el.getAttribute('data-qid'));
    if(tg)tg.classList.toggle('open');
  }
  else if(act==='rv-moveto'){rvActMoveTo(el.getAttribute('data-qid'),el.getAttribute('data-to'));}
  else if(act==='rv-skip'){rvActSkip(el.getAttribute('data-qid'));}
  else if(act==='rv-undo'){delete DECIDE[el.getAttribute('data-qid')];rvSaveDecide();renderReview();}
  else if(act==='settings'){openSettings();}
  else if(act==='skin'){
    var sk=el.getAttribute('data-k');
    saveJSON('shiju.skin.v1',sk);
    skinApply(sk);
    /* 分享图的默认背景跟着当前底色走，省得每次都重选 */
    if(window.SJIShare&&window.SJIShare.themes)window.SJIShare.syncSkin(sk);
  }
  /* 不传主题：share.js 内部回落到当前页面底色 */
else if(act==='share'){window.SJIShare.open(el.getAttribute('data-id'),document.documentElement.getAttribute('data-skin'));}
  else if(act==='sh-theme'){window.SJIShare.theme(el.getAttribute('data-k'));}
  else if(act==='sh-format'){window.SJIShare.format(el.getAttribute('data-k'));}
  else if(act==='sh-save'){window.SJIShare.save();}
  else if(act==='sh-close'){window.SJIShare.close();}
  else if(act==='set-close'){$('setOverlay').classList.remove('open');}
  else if(act==='export'){
    var rows=[];
    Object.keys(NOTES).forEach(function(id){
      var r=NOTES[id];
      r.notes.forEach(function(n){rows.push({qid:id,occ:r.occ||0,book:r.book,loc:r.loc,cat:r.cat,text:n.t,date:n.at});});
    });
    var blob=new Blob([JSON.stringify({app:'拾句',exported:todayStr(),notes:rows},null,2)],{type:'application/json'});
    var a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='拾句手记-'+todayStr()+'.json';a.click();
    setTimeout(function(){URL.revokeObjectURL(a.href);},2000);
    toast('已导出 '+rows.length+' 则手记');
  }
  else if(act==='import'){$('importFile').click();}
  else if(act==='pack-import'){$('packFile').click();}
  else if(act==='sync-save'){
    var cfgText=($('syncCfg').value||'').trim();
    if(!cfgText){toast('先粘贴推送脚本打印的那行配置');return;}
    var sc2=null;try{sc2=JSON.parse(cfgText);}catch(e){}
    if(!sc2||!sc2.owner||!sc2.repo){toast('配置不完整：需要 owner / repo');return;}
    var tkIn=$('syncToken');
    if(!tkIn||(tkIn.value||'').replace(/\s+/g,'')===''){toast('把访问令牌填进令牌框');return;}
    sc2.v='gitee1';
    sc2.branch=sc2.branch||'master';
    sc2.dir=String(sc2.dir||'sync').replace(/^\/+|\/+$/g,'');
    SYNC={v:'gitee1',owner:sc2.owner,repo:sc2.repo,branch:sc2.branch,dir:sc2.dir,token:($('syncToken').value||'').replace(/\s+/g,'')};
    saveJSON('shiju.sync',SYNC);
    try{localStorage.removeItem('shiju.sync.v');}catch(e){}
    syncCheck(true).then(function(){openSettings();});
  }
  else if(act==='sync-off'){
    SYNC=null;try{localStorage.removeItem('shiju.sync');localStorage.removeItem('shiju.sync.v');}catch(e){}
    openSettings();toast('已停用云端同步（本机数据保留）');
  }
  else if(act==='pack-wipe'){
    if(!PACK){toast('本机没有导入的数据包');return;}
    if(!packWipeArmed){
      packWipeArmed=true;$('packWipeBtn').textContent='确认清除？';
      $('packWipeBtn').style.borderColor='var(--accent)';$('packWipeBtn').style.color='var(--accent)';return;
    }
    packClear().then(function(){toast('已移除，正在恢复页面内置数据…');setTimeout(function(){location.reload();},700);});
  }
  else if(act==='wipe'){
    if(!wipeArmed){wipeArmed=true;$('wipeBtn').textContent='确认清空？';$('wipeBtn').style.borderColor='var(--accent)';$('wipeBtn').style.color='var(--accent)';}
    else{NOTES={};saveJSON('shiju.notes.v1',NOTES);openSettings();toast('本机手记已清空');if(STATE.view==='notes')renderNotes();}
  }
});
function rvExportRows(){
  var rows=[];
  Object.keys(DECIDE).forEach(function(qid){
    var d=DECIDE[qid];
    var it=RV.items.filter(function(x){return x.qid===qid;})[0];
    if(!it)return;
    rows.push({book:it.book,loc:it.loc,decision:d.decision,from:d.from,to:d.to,date:d.at,text:it.text});
  });
  return rows;
}
document.body.addEventListener('keydown',function(ev){
  var tag=(ev.target&&ev.target.tagName)?ev.target.tagName.toLowerCase():'';
  if(tag==='input'||tag==='textarea')return;
  if($('noteOverlay').classList.contains('open')||$('setOverlay').classList.contains('open')||$('shOverlay').classList.contains('open'))return;
  if(STATE.view!=='review'||RVF.f!=='todo')return;
  /* 小键盘键位判定**必须按 ev.code，不能按 ev.key**。
     NumLock 关闭时小键盘是导航区，浏览器把 Numpad2 报成 key='ArrowDown'、
     Numpad4 报成 'ArrowLeft'、Numpad1 报成 'End' —— 若先匹配 key，
     小键盘 2 会被当成「下移」、小键盘 1 会被当成「跳到末尾」。
     code 恒为 Numpad1/2/4/6，与 NumLock 状态无关，是唯一可靠的判据。 */
  var code=ev.code||'';

  /* 上下切换、左右翻页与筛选状态无关，只认主键盘方向键 */
  if(code==='ArrowDown'){ev.preventDefault();rvFocus(1);return;}
  if(code==='ArrowUp'){ev.preventDefault();rvFocus(-1);return;}
  if(code==='ArrowRight'||code==='PageDown'||code==='Numpad6'){ev.preventDefault();rvGoPage(1);return;}
  if(code==='ArrowLeft'||code==='PageUp'||code==='Numpad4'){ev.preventDefault();rvGoPage(-1);return;}

  /* 拍板：小键盘 1 / 2 / 空格（同时兼容主键盘的 1、2、空格） */
  var isNum=(code==='Numpad1'||code==='Digit1');
  var isMove=(code==='Numpad2'||code==='Digit2');
  var isSkip=(code==='Space');

  if(!RVC){
    /* 还没选中任何卡时，先让第一张卡获得高亮，之后再按才有意义 */
    if(isNum||isMove||isSkip){rvFocus(0,false);if(isNum)rvActKeep(RVC);else if(isMove){var tg0=$('tg-'+RVC);if(tg0)tg0.classList.toggle('open');}else rvActSkip(RVC);}
    return;
  }
  if(isNum){ev.preventDefault();rvActKeep(RVC);}
  else if(isMove){ev.preventDefault();var tg=$('tg-'+RVC);if(tg)tg.classList.toggle('open');}
  else if(isSkip){ev.preventDefault();rvActSkip(RVC);}
});
document.body.addEventListener('keydown',function(ev){
  if(ev.key==='Escape'){$('noteOverlay').classList.remove('open');$('setOverlay').classList.remove('open');window.SJIShare.close();}
});
$('noteOverlay').addEventListener('click',function(ev){if(ev.target===this)closeNote();});
$('setOverlay').addEventListener('click',function(ev){if(ev.target===this)this.classList.remove('open');});
/* 分享弹层：点遮罩空白处关闭（ev.target===this 表示点在 .overlay 本身而非 .panel） */
$('shOverlay').addEventListener('click',function(ev){if(ev.target===this)window.SJIShare.close();});
/* 点复核卡片任意空白处即选中它（点按钮不触发，避免与拍板操作打架） */
document.body.addEventListener('click',function(ev){
  if(STATE.view!=='review')return;
  if(ev.target.closest('[data-act]'))return;
  var card=ev.target.closest('.rv-card');
  if(!card)return;
  RVC=card.getAttribute('data-qid');
  rvPaint();
});
$('importFile').addEventListener('change',function(){
  var f=this.files[0];this.value='';if(!f)return;
  var rd=new FileReader();
  rd.onload=function(){
    try{
      var obj=JSON.parse(rd.result),list=obj&&obj.notes?obj.notes:[];
      var added=0;
      list.forEach(function(n){
        if(!n||!n.book||!n.loc||!n.text)return;
        var e=null;
        if(n.qid&&byId[n.qid]&&byId[n.qid].book===n.book&&byId[n.qid].loc===n.loc){e=byId[n.qid];}
        else{
          var occ=n.occ||0,c=0;
          for(var i=0;i<DATA.entries.length;i++){
            var t=DATA.entries[i];
            if(t.book===n.book&&t.loc===n.loc){if(c===occ){e=t;break;}c++;}
          }
        }
        if(!e)return;
        var id=e.id;
        if(!NOTES[id]){NOTES[id]={book:e.book,loc:e.loc,cat:e.cat,occ:e.occ,notes:[]};}
        var dup=NOTES[id].notes.some(function(x){return x.t===n.text&&x.at===n.date;});
        if(!dup){NOTES[id].notes.push({t:n.text,at:n.date||todayStr()});added++;}
      });
      saveJSON('shiju.notes.v1',NOTES);
      openSettings();toast('导入完成，新增 '+added+' 则');
    }catch(e){toast('导入失败：文件格式不正确');}
  };
  rd.readAsText(f,'utf-8');
});

/* 导入摘录数据包：读文件 → 解析 → 存本机 → 重载。
   重载是为了让摘录索引、分类表、每日排程全部按新数据重建，
   比在原对象上做增量替换可靠得多，何况这是低频操作。 */
$('packFile').addEventListener('change',function(){
  var f=this.files[0];this.value='';if(!f)return;
  var rd=new FileReader();
  rd.onload=function(){
    var parsed=null;
    try{parsed=packParse(rd.result);}catch(e){parsed=null;}
    if(!parsed||!parsed.data||!parsed.data.entries){toast('导入失败：这不是一份可用的数据包');return;}
    packSave({data:parsed.data,review:parsed.review||null,imported:todayStr()}).then(function(){
      toast('已导入 '+parsed.data.entries.length+' 条摘录，正在载入…');
      setTimeout(function(){location.reload();},700);
    }).catch(function(){toast('存入本机失败，可能是浏览器禁止了本地存储');});
  };
  rd.onerror=function(){toast('读取文件失败');};
  rd.readAsText(f,'utf-8');
});

/* 阅读位置：滚动节流记录 */
var progTick=false;
window.addEventListener('scroll',function(){
  var tt=$('toTop');
  if(tt)tt.classList.toggle('show',window.scrollY>420);
  if(STATE.view!=='cat'||progTick)return;
  progTick=true;
  setTimeout(function(){progTick=false;updateProg(STATE.ci);updateToc();},350);
},{passive:true});

/* ================= 本机数据包 =================
   手机上的个人摘录存在 IndexedDB，而不是 localStorage：后者只有约 5 MB，
   且按 UTF-16 计费，个人全量数据（1.5 MB 上下）很容易撞上限；
   IndexedDB 容量大得多，还能直接存对象，省去来回字符串化。

   电脑上通常用不到它——电脑端靠构建脚本产出 data.local.js 就够了。
   它的价值在手机：页面装到桌面后没有一个地方容纳那个 .js 文件，
   就靠这里存一份，导一次长期有效，断网也在。 */
var PACK_DB='shiju', PACK_STORE='pack', PACK_KEY='current';

function packOpen(){
  return new Promise(function(res,rej){
    if(!window.indexedDB){rej(new Error('no-idb'));return;}
    var rq=indexedDB.open(PACK_DB,1);
    rq.onupgradeneeded=function(){var db=rq.result;if(!db.objectStoreNames.contains(PACK_STORE))db.createObjectStore(PACK_STORE);};
    rq.onsuccess=function(){res(rq.result);};
    rq.onerror=function(){rej(rq.error);};
  });
}
function packLoad(){
  return packOpen().then(function(db){
    return new Promise(function(res,rej){
      var rq=db.transaction(PACK_STORE,'readonly').objectStore(PACK_STORE).get(PACK_KEY);
      rq.onsuccess=function(){res(rq.result||null);};
      rq.onerror=function(){rej(rq.error);};
    });
  }).catch(function(){return null;});
}
function packSave(pack){
  return packOpen().then(function(db){
    return new Promise(function(res,rej){
      var rq=db.transaction(PACK_STORE,'readwrite').objectStore(PACK_STORE).put(pack,PACK_KEY);
      rq.onsuccess=function(){res(true);};
      rq.onerror=function(){rej(rq.error);};
    });
  }).then(function(){
    /* 同步标记：下次启动凭它立刻决定「要不要等一次异步查询」 */
    try{localStorage.setItem('shiju.pack.mark','1');}catch(e){}
    return true;
  });
}
function packClear(){
  return packOpen().then(function(db){
    return new Promise(function(res,rej){
      var rq=db.transaction(PACK_STORE,'readwrite').objectStore(PACK_STORE).delete(PACK_KEY);
      rq.onsuccess=function(){res(true);};
      rq.onerror=function(){rej(rq.error);};
    });
  }).then(function(){
    try{localStorage.removeItem('shiju.pack.mark');}catch(e){}
    return true;
  }).catch(function(){return false;});
}

/* 解析一份数据包，两种形态都收：
   ① data.local.js —— 脚本形式。交给它一个假的 window 承接赋值语句，
      既不必真的执行到全局，也不会污染现有 window；
   ② 纯 JSON —— 构建脚本的中间产物或手工整理的数据。
   数据包由使用者亲手选择，等同执行自己的构建产物，不引入外部脚本。 */
function packParse(text){
  var t=String(text==null?'':text).replace(/^\uFEFF/,'').trim();
  if(!t)return null;
  if(t.charAt(0)==='{'){
    var o=JSON.parse(t);
    return {
      data:o.SHIJU_DATA||o.data||(o.entries?o:null),
      review:o.SHIJU_REVIEW||o.review||(o.items?o:null)
    };
  }
  var sandbox={};
  (new Function('window',t))(sandbox);
  return {data:sandbox.SHIJU_DATA||null,review:sandbox.SHIJU_REVIEW||null};
}

/* ================= 云端同步（Gitee 私有仓库） =================
   手机端自动更新的最后一环：电脑 scripts/push-gitee.js 把数据包推进私有仓库，
   这里在打开/回前台时静默比对清单版本，有新版才拉全量。

   为什么走 blobs 而不是 contents 取分片：清单里存的是每片的 git blob sha
   （内容哈希），旧版本的历史 blob 永远可取——推送途中被拉取的客户端
   不会读到半新半旧的数据。

   请求全部是带 query token 的 GET：简单请求免 CORS 预检（Gitee API 域名
   本身也实测放行任意 Origin，2026-10）。任何失败都静默——同步不能打扰阅读。 */
var SYNC=loadJSON('shiju.sync',null);
var SYNCST=loadJSON('shiju.sync.state',null);
var syncLastTick=Date.now();

function nowStamp(){var d=new Date();return todayStr()+' '+p2(d.getHours())+':'+p2(d.getMinutes());}
function b64ToBytes(b64){
  var bin=atob(b64),n=bin.length,arr=new Uint8Array(n);
  for(var i=0;i<n;i++)arr[i]=bin.charCodeAt(i);
  return arr;
}
/* 带超时的 GET：5 秒等不到就放弃，不留悬挂请求 */
function syncFetch(url){
  var opts={},timer=null;
  if(typeof AbortController!=='undefined'){
    var c=new AbortController();opts.signal=c.signal;
    timer=setTimeout(function(){c.abort();},5000);
  }
  return fetch(url,opts).then(function(r){
    if(timer)clearTimeout(timer);
    if(!r.ok){var e=new Error('HTTP '+r.status);e.status=r.status;throw e;}
    return r.json();
  },function(err){
    if(timer)clearTimeout(timer);throw err;
  });
}
function syncCfgUrl(){
  return 'https://gitee.com/api/v5/repos/'+encodeURIComponent(SYNC.owner)+'/'+encodeURIComponent(SYNC.repo)
    +'/contents/'+encodeURIComponent(SYNC.dir||'sync')+'/manifest.json'
    +'?ref='+encodeURIComponent(SYNC.branch||'master')
    +'&access_token='+encodeURIComponent(SYNC.token);
}
function syncBlobUrl(sha){
  return 'https://gitee.com/api/v5/repos/'+encodeURIComponent(SYNC.owner)+'/'+encodeURIComponent(SYNC.repo)
    +'/git/blobs/'+sha+'?access_token='+encodeURIComponent(SYNC.token);
}

/* 按清单拼装全量数据并存为本机数据包（与手动导入走同一存储，优先级不变） */
function syncApply(mf){
  var reqs=mf.parts.map(function(p){return syncFetch(syncBlobUrl(p.sha));});
  if(mf.review)reqs.push(syncFetch(syncBlobUrl(mf.review.sha)));
  return Promise.all(reqs).then(function(rs){
    var dec=new TextDecoder('utf-8');
    var texts=rs.map(function(r){return dec.decode(b64ToBytes(r.content));});
    var entries=[];
    for(var i=0;i<mf.parts.length;i++){
      var arr=JSON.parse(texts[i]);
      if(!Array.isArray(arr))throw new Error('分片 '+i+' 格式异常');
      entries=entries.concat(arr);
    }
    if(!mf.data||!mf.data.meta||!mf.data.cats||!entries.length)throw new Error('清单数据不完整');
    var pack={
      data:{meta:mf.data.meta,cats:mf.data.cats,authors:mf.data.authors||{},entries:entries},
      review:mf.review?JSON.parse(texts[mf.parts.length]):null,
      imported:todayStr(),syncV:mf.v
    };
    return packSave(pack).then(function(){
      saveJSON('shiju.sync.v',mf.v);
      SYNCST={at:nowStamp(),ok:true,msg:'已同步 '+entries.length+' 条 · '+mf.v};
      saveJSON('shiju.sync.state',SYNCST);
      return entries.length;
    });
  });
}

/* 取清单：contents 接口对 ≤1MB 文件回 base64 content，更大只回 sha——两种形态都接住
   （清单很小，正常走前者；sha 分支是防御。修复前把 contents 包装对象当清单用，
   真服务上必现「清单不完整」——联调驱动手写解包恰好掩盖了这处客户端缺陷）。 */
function syncGetManifest(){
  return syncFetch(syncCfgUrl()).then(function(w){
    if(w&&typeof w.content==='string'&&w.encoding==='base64'){
      return JSON.parse(new TextDecoder('utf-8').decode(b64ToBytes(w.content)));
    }
    if(w&&w.sha){
      return syncFetch(syncBlobUrl(w.sha)).then(function(b){
        return JSON.parse(new TextDecoder('utf-8').decode(b64ToBytes(b.content)));
      });
    }
    throw new Error('清单响应异常');
  });
}

/* 检查并按需拉取。manual=true 时给 toast 反馈；自动检查一律静默 */
function syncCheck(manual){
  if(!SYNC)return Promise.resolve(false);
  return syncGetManifest().then(function(mf){
    if(!mf||!mf.v||!mf.data||!Array.isArray(mf.parts)||!mf.parts.length)throw new Error('清单不完整');
    if(loadJSON('shiju.sync.v',null)===mf.v){
      SYNCST={at:nowStamp(),ok:true,msg:'已是最新 · '+mf.v};saveJSON('shiju.sync.state',SYNCST);
      if(manual)toast('云端没有新数据，已是最新');
      return false;
    }
    return syncApply(mf).then(function(n){
      toast('摘录已自动更新：'+n+' 条，正在载入…');
      setTimeout(function(){location.reload();},900);
      return true;
    });
  }).catch(function(err){
    SYNCST={at:nowStamp(),ok:false,msg:(err&&err.message)?err.message:'网络错误'};
    saveJSON('shiju.sync.state',SYNCST);
    if(manual)toast('同步失败：'+SYNCST.msg);
    return false;
  });
}

/* 拉起时机：打开 1.5 秒后查一次（错开首屏渲染）；回到前台至少隔 30 分钟 */
setTimeout(function(){syncCheck(false);},1500);
window.addEventListener('visibilitychange',function(){
  try{if(document.visibilityState!=='visible')return;}catch(e){return;}
  var now=Date.now();
  if(now-syncLastTick<30*60*1000)return;
  syncLastTick=now;
  syncCheck(false);
});

/* ================= 启动 ================= */
/* 底色要先应用再渲染，否则首屏会闪一下默认米色 */
skinInit();

/* 数据有两个来源，优先级：本机数据包 > 页面内置数据。
   本机包只能异步读，但绝大多数设备（电脑、没导入过的手机）根本用不上它，
   于是先用 localStorage 里一个同步标记分流：
   没导入过 → 直接上内置数据，首屏零等待；导入过 → 等异步查询结果再渲染。
   标记与实际内容万一不同步也无妨，下面两条分支各自都能兜住。 */
var builtin=(window.SHIJU_DATA&&window.SHIJU_DATA.entries)?window.SHIJU_DATA:null;
var marked=false;
try{marked=localStorage.getItem('shiju.pack.mark')==='1';}catch(e){}

if(builtin&&!marked){
  try{init(builtin);}catch(e){}
  bootView();
}

packLoad().then(function(pack){
  if(!(pack&&pack.data&&pack.data.entries)){
    if(!booted&&builtin){try{init(builtin);}catch(e){}}
    bootView();
    return;
  }
  PACK=pack;
  if(pack.review)window.SHIJU_REVIEW=pack.review;
  /* 数据源切换判定（2026-10-12 修）：
     原先用 `DATA!==pack.data` 比较对象引用，但 pack.data 来自 IndexedDB、
     是反序列化出的**新对象**，即便内容与内置数据完全一致也永远 `!==`，
     于是 resetData()+init() 会被无谓地再跑一遍。若两次 init 落到同一批
     entries 对象上，byBook/byCat 就会被重复填充，表现为「同一条摘录出现两条」
     （只收录 1 条的书最明显，如《国术》《炸裂志》）。
     改为按**内容指纹**判断，并让 init 自身幂等，双保险。 */
  var sameData = DATA && dataFingerprint(DATA) === dataFingerprint(pack.data);
  if(!sameData){
    resetData();
    try{init(pack.data);}catch(e){}
    /* 同步路径已经渲染过内置数据，这里重画一次换成个人数据 */
    if(booted)openView('home');
  }
  bootView();
});

/* 重建前清空全部派生索引，避免旧数据的分类表/书目表与新数据叠加 */
function resetData(){
  DATA=null;M=null;
  byBook={};byCat={};byId={};
}

var booted=false;
function bootView(){
  if(booted)return;
  booted=true;
  if(DATA){
    openView('home');
  }else{
    $view.innerHTML='<div class="kick">拾句 · 尚未注入数据</div>'
      +'<p class="view-sub">没有检测到数据文件（data/data.js 或 data.local.js）。运行构建脚本，把你的「书籍笔记分类索引」解析注入：</p>'
      +'<p class="daily-text" style="font-size:17px">node scripts/build.js --index &lt;索引目录&gt;</p>'
      +'<p class="view-sub">脚本会解析分类 md、校验条数并生成 data.local.js（个人数据，不入库）；随后刷新本页即可。</p>';
  }
}
})();
