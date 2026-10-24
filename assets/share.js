/* =========================================================
 * 拾句 · 分享图
 * 把一条摘录绘成可保存的图片（JPEG）。
 *
 * 设计要点：
 *  1) 宽度固定（720），高度随句子长度自动增长——摘录多长，图就多高，
 *     绝不截断、绝不省略。
 *  2) 只做横版，提供多套背景（纸/夜/青/朱砂），一套版式多种气质。
 *  3) 全部用 Canvas 手绘，不依赖任何外部库与字体文件。
 * ========================================================= */
(function(){
'use strict';

/* 与 style.css 同一套字体栈：优先思源宋体，退回系统宋体 */
var SERIF='"Noto Serif SC","Source Han Serif SC","Source Han Serif CN","Songti SC","STSong","SimSun",serif';
var MONO='ui-monospace,"Cascadia Mono","Consolas",monospace';

function $(id){return document.getElementById(id);}

/* ---------- 版面参数 ----------
   两个版式，各有固定的宽度与标准比例：
     portrait  竖版 720 × 960  （3:4，社交平台通用）
     landscape 横版 960 × 720  （4:3，适合长句——同样的字数少占宽度、行数少）
   高度规则（两个方向一致）：
     · 内容放得下  → 保持该版式的标准尺寸，多出来的空间平分给上下，文字整体居中
     · 放不下      → 宽度不变、向下加高，直到把全文装完
   绝不截断、绝不省略。 */
var FORMAT={
  portrait: {w:720, baseH:960, maxSize:40},
  landscape:{w:960, baseH:720, maxSize:34}
};
var FORMAT_ORDER=['portrait','landscape'];
var FRAME_M=30;            /* 外框到画布边缘的距离 */
var PAD_X=48;              /* 外框以内再留的版心边距 */
var BODY_X=FRAME_M+PAD_X; /* 正文左边界 = 78 */
var MIN_SIZE=21;           /* 正文字号下限（再小就看不清了） */
var LINE_H=1.95;           /* 行高倍数 */
var HEAD_H=118;            /* 页眉区高度 */
var FOOT_H=182;            /* 落款区高度：正文下方 52 + 分隔线 + 三行 100 + 底部留白 30 */
var SEAL_TEXT_GAP=46;      /* 页眉文字列相对印章中心的水平距离：文字起笔 x=110，距印章右缘 84 净空 26 */
var LABEL_DY=36;           /* 「每 日 一 句」基线相对印章中心（y=72）的偏移：基线 y=108，与「拾句」基线 74 之间净空约 20px */
/* 左上角的类别号（01…10，即上标）：与页眉的日期同高、分列左右两端，
   只占既有留白。 */

/* ---------- 背景主题 ----------
   每套背景给出纸色、正文色、辅助色、印鉴色与装饰参数。 */
var THEME={
  paper:{   /* 宣纸：默认，暖米色 */
    name:'宣纸',
    bg:'#f6f1e7', ink:'#241f16', ink2:'#5f574a', ink3:'#6f6656',
    accent:'#963a22', rule:'rgba(143,133,116,.85)', frame:'rgba(217,207,186,1)',
    frameIn:'rgba(150,58,34,.16)', grain:'rgba(36,31,22,1)', grainA:0.5,
    vignette:[['rgba(150,58,34,.055)','rgba(150,58,34,0)',-0.14],
              ['rgba(36,31,22,.05)','rgba(36,31,22,0)',1.04]]
  },
  night:{   /* 夜墨：深色，适合夜里发 */
    name:'夜墨',
    bg:'#1c1a17', ink:'#ece5d8', ink2:'#b0a794', ink3:'#98917e',
    accent:'#c96a4a', rule:'rgba(176,167,148,.6)', frame:'rgba(120,112,98,.5)',
    frameIn:'rgba(201,106,74,.24)', grain:'rgba(236,229,216,1)', grainA:0.34,
    vignette:[['rgba(201,106,74,.07)','rgba(201,106,74,0)',-0.14],
              ['rgba(0,0,0,.22)','rgba(0,0,0,0)',1.04]]
  },
  celadon:{ /* 青瓷：冷调素雅 */
    name:'青瓷',
    bg:'#dfe5dd', ink:'#26302a', ink2:'#4d5a51', ink3:'#5d6b61',
    accent:'#8a3a2a', rule:'rgba(77,90,81,.7)', frame:'rgba(125,139,129,.45)',
    frameIn:'rgba(138,58,42,.18)', grain:'rgba(38,48,42,1)', grainA:0.4,
    vignette:[['rgba(38,48,42,.05)','rgba(38,48,42,0)',-0.14],
              ['rgba(38,48,42,.06)','rgba(38,48,42,0)',1.04]]
  },
  cinnabar:{/* 朱砂：整幅赭红，正文转米色 */
    name:'朱砂',
    bg:'#8f3820', ink:'#f7efe0', ink2:'#e8cdb6', ink3:'#f2d8bc',
    accent:'#f7efe0', rule:'rgba(247,239,224,.55)', frame:'rgba(247,239,224,.38)',
    frameIn:'rgba(247,239,224,.18)', grain:'rgba(60,20,10,1)', grainA:0.3,
    vignette:[['rgba(255,240,220,.08)','rgba(255,240,220,0)',-0.14],
              ['rgba(50,16,8,.2)','rgba(50,16,8,0)',1.04]]
  }
};
var THEME_ORDER=['paper','night','celadon','cinnabar'];

/* ---------- 基础绘制工具 ---------- */

function rr(ctx,x,y,w,h,r){
  ctx.beginPath();
  ctx.moveTo(x+r,y);
  ctx.lineTo(x+w-r,y);ctx.quadraticCurveTo(x+w,y,x+w,y+r);
  ctx.lineTo(x+w,y+h-r);ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
  ctx.lineTo(x+r,y+h);ctx.quadraticCurveTo(x,y+h,x,y+h-r);
  ctx.lineTo(x,y+r);ctx.quadraticCurveTo(x,y,x+r,y);
  ctx.closePath();
}

/* 纸纹噪点：生成一块 128×128 的噪点瓦片后按图案平铺。
   注意两点：
   ① 填充范围必须严格等于画布尺寸——写成 1e5×1e5 会让图案平铺在
      十亿像素上空转，页面直接卡死；
   ② 瓦片按颜色缓存，切换背景主题时重建，避免重复生成。 */
var noiseCache={};
function noise(ctx,W_,H_,color,alpha){
  if(!noiseCache[color]){
    var c=document.createElement('canvas');c.width=c.height=128;
    var g=c.getContext('2d'),img=g.createImageData(128,128),d=img.data;
    var rgb=hexToRgb(color);
    for(var i=0;i<d.length;i+=4){
      var v=Math.random();
      d[i]=rgb[0];d[i+1]=rgb[1];d[i+2]=rgb[2];
      d[i+3]=v>0.86?(v-0.86)*760:0;      /* 稀疏、微弱的颗粒 */
    }
    g.putImageData(img,0,0);
    noiseCache[color]=c;
  }
  ctx.save();
  ctx.globalAlpha=alpha;
  ctx.fillStyle=ctx.createPattern(noiseCache[color],'repeat');
  ctx.fillRect(0,0,W_,H_);
  ctx.restore();
}
function hexToRgb(h){
  var s=h.replace('#','');
  if(s.length===3)s=s[0]+s[0]+s[1]+s[1]+s[2]+s[2];
  var n=parseInt(s,16);
  return [(n>>16)&255,(n>>8)&255,n&255];
}

/* 纸底：底色 + 两处极淡的暖晕（按主题取色） */
function paper(ctx,W_,H_,t){
  ctx.fillStyle=t.bg;ctx.fillRect(0,0,W_,H_);
  t.vignette.forEach(function(v){
    var x=W_/2,y=H_*v[2];
    var g=ctx.createRadialGradient(x,y,0,x,y,H_*0.95);
    g.addColorStop(0,v[0]);g.addColorStop(1,v[1]);
    ctx.fillStyle=g;ctx.fillRect(0,0,W_,H_);
  });
  noise(ctx,W_,H_,t.grain,t.grainA);
}

/* 印鉴：外粗内细双线 + 「拾」字，微微倾斜，像盖上去的 */
function seal(ctx,cx,cy,size,t){
  ctx.save();
  ctx.translate(cx,cy);ctx.rotate(-0.055);
  ctx.strokeStyle=t.accent;
  ctx.lineWidth=Math.max(1.5,size*0.055);
  rr(ctx,-size/2,-size/2,size,size,size*0.07);ctx.stroke();
  ctx.globalAlpha=.4;ctx.lineWidth=Math.max(1,size*0.022);
  rr(ctx,-size/2+size*0.09,-size/2+size*0.09,size*0.82,size*0.82,size*0.05);ctx.stroke();
  ctx.globalAlpha=1;ctx.fillStyle=t.accent;
  ctx.font='500 '+(size*0.54)+'px '+SERIF;
  ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillText('拾',0,size*0.03);
  ctx.restore();
}

/* 外框：细线 + 内侧更淡的副线，仿宋刻本栏界 */
function frame(ctx,W_,H_,m,t){
  ctx.strokeStyle=t.frame;ctx.lineWidth=1;
  ctx.strokeRect(m,m,W_-m*2,H_-m*2);
  ctx.strokeStyle=t.frameIn;
  ctx.strokeRect(m+7,m+7,W_-(m+7)*2,H_-(m+7)*2);
}

/* 细分隔线：中间一小段实线，两侧渐隐 */
function rule(ctx,cx,y,w,color){
  var g=ctx.createLinearGradient(cx-w/2,0,cx+w/2,0);
  g.addColorStop(0,'rgba(143,133,116,0)');
  g.addColorStop(.5,color);
  g.addColorStop(1,'rgba(143,133,116,0)');
  ctx.fillStyle=g;ctx.fillRect(cx-w/2,y,w,1);
}

/* ---------- 排版：中文按字断行 ---------- */

var NO_HEAD='，。、！？；：）】》」』”’…·—';
function wrap(ctx,text,maxW){
  var out=[];
  String(text).split('\n').forEach(function(para){
    var line='',i,ch;
    if(!para){out.push('');return;}
    for(i=0;i<para.length;i++){
      ch=para.charAt(i);
      var test=line+ch;
      if(line && ctx.measureText(test).width>maxW){
        /* 标点不许落在行首：把它连同前一字一起挪下去 */
        if(NO_HEAD.indexOf(ch)>=0 && line.length>1){out.push(line);line='';}
        else if(line.length>1 && NO_HEAD.indexOf(line.slice(-1))>=0){
          out.push(line.slice(0,-1));line=line.slice(-1);
        }else{out.push(line);line='';}
        line+=ch;
      }else{line=test;}
    }
    out.push(line);
  });
  return out;
}

/* 落款固定文本：超宽按比例砍一刀加省略号（不做逐字回退，长文本会空转） */
function fitText(ctx,s,maxW){
  s=String(s||'');
  if(ctx.measureText(s).width<=maxW)return s;
  for(var keep=Math.max(1,s.length-1);keep>0;keep=Math.max(1,Math.floor(keep*0.8))){
    var c=s.slice(0,keep)+'…';
    if(ctx.measureText(c).width<=maxW)return c;
  }
  return '…';
}

/* ---------- 排版计算：不定高度，先量出内容有多高 ---------- */

/* 开引号占位的宽度（正文整体右移这么多） */
function quoteMark(ctx,size){
  ctx.font='400 '+Math.round(size*1.15)+'px '+SERIF;
  return ctx.measureText('「').width;
}

/* 引号的垂直修正量。
   宋体里「」这两个字形不在同一水平位，而且都偏低。实测（思源宋体，
   引号字号 = 1.15×正文字号，取字号 37 为例）：
     「  基线以上 36px、以下 9px
     」  基线以上 24px、以下 3px     ← 比开引号整整低 12px
     方  基线以上 36px              ← 汉字才是"正常"高度
   于是需要两个偏移：
     LIFT 把两个引号一起上提，使引号上沿略高于汉字上沿（居上一点更像版面角标，
           也顺带把闭引号从基线下方提回来）；
     SKEW 单独给闭引号补掉它相对开引号的固有下沉 —— 不补就会左高右低，
           一眼看出不对称。
   两个系数都按字号等比缩放，实测在 21–40px 全区间一致。 */
var LIFT_R=0.19;      /* 上提量 = 0.19 × 正文字号 */
var QUOTE_SKEW_R=0.325; /* 闭引号额外上提 = 0.325 × 正文字号（补字形固有下沉） */
function quoteLift(size){return Math.round(size*LIFT_R);}
function quoteSkew(size){return Math.round(size*QUOTE_SKEW_R);}

/* 试排：给定字号与版式，返回行数组与各区块高度。
   contentH = 页眉 + 正文块 + 落款，即「文字真正需要的纵向空间」。 */
function layoutAt(ctx,text,size,F){
  ctx.font='400 '+size+'px '+SERIF;
  var qm=quoteMark(ctx,size);
  /* 正文左边界 = 版心左 + 引号位；右边界固定为版心右。
     这里必须用「右边界 − 左边界」，早先误写成 W-PAD_X*2-qm，
     等于没减左边界，导致文字右侧穿出版心。 */
  var left=BODY_X+qm;
  var right=F.w-BODY_X;
  var maxW=right-left;
  var lines=wrap(ctx,text,maxW);
  var lh=Math.round(size*LINE_H);
  var blockH=lines.length*lh;
  return {size:size,lh:lh,lines:lines,qm:qm,maxW:maxW,left:left,
          blockH:blockH,contentH:HEAD_H+blockH+FOOT_H};
}

/* 选字号：从大到小试，取第一个「能装进该版式标准高度」的。
   装得下 → 保持标准尺寸，剩余空间留给留白；
   都装不下 → 用最小号并让图向下加高（宽度不变）。 */
function layout(ctx,text,F){
  var i,L;
  for(i=F.maxSize;i>=MIN_SIZE;i--){
    L=layoutAt(ctx,text,i,F);
    if(L.contentH<=F.baseH)return L;
  }
  return layoutAt(ctx,text,MIN_SIZE,F);
}

/* 最终高度：标准高度与实际内容高度取大者 */
function totalH(L,F){
  return Math.max(F.baseH,L.contentH+FRAME_M);
}

/* ---------- 绘制 ---------- */

function drawCard(ctx,H,e,t,F){
  var text=String(e.text||'').replace(/\r/g,'');
  var L=layout(ctx,text,F);
  var size=L.size,lh=L.lh,lines=L.lines,qm=L.qm;
  var cx=F.w/2;

  paper(ctx,F.w,H,t);
  frame(ctx,F.w,H,FRAME_M,t);

  /* 页眉：小印鉴 + 栏目名 + 日期（与正文共用 BODY_X 版心）。
     印章与文字列各自占位、互不侵犯：文字列从印章中心右移
     SEAL_TEXT_GAP 起笔（x=110，距印章右缘 84 约 26px 净空，
     即使个别设备把字距撑宽一倍也压不到边框）；「每 日 一 句」
     基线由 LABEL_DY 定在 y=108，与「拾句」基线 74 之间留出
     一行小字的净空，不再两行贴在一起。 */
  var hy=FRAME_M+42;
  seal(ctx,BODY_X-14,hy,40,t);
  var textX=BODY_X-14+SEAL_TEXT_GAP;
  ctx.textAlign='left';ctx.textBaseline='alphabetic';
  ctx.fillStyle=t.ink;ctx.font='500 24px '+SERIF;
  ctx.fillText('拾句',textX,hy+2);
  ctx.fillStyle=t.ink3;ctx.font='400 14px '+MONO;
  ctx.fillText('每 日 一 句',textX,hy+LABEL_DY);
  ctx.textAlign='right';ctx.fillStyle=t.ink3;
  ctx.fillText(e.date,F.w-BODY_X,hy+2);

  /* 左上角上标：类别号。它与印章共用版心左边界，但印章只占版心高度的一半，
     编号就落在印章右下方、与「每 日 一 句」同一基线——离印章边框只剩十几像素，
     看着像挤在印章底下，且与下方那条基线重复。
     所以这里不逐字符排版，而是把「数字」画到临时画布上搬到页眉右端：
     页眉于是成「印章 + 栏目名……类别号 · 日期」的等距三段。 */
  var sup=e.catNo||'';
  var dateX=F.w-BODY_X;
  if(sup){
    ctx.fillStyle=t.accent;ctx.font='400 14px '+MONO;
    var sw=Math.ceil(ctx.measureText(sup).width)+4, sh=18;
    var tmp=document.createElement('canvas');
    tmp.width=Math.round(sw*2);tmp.height=Math.round(sh*2);
    var tg=tmp.getContext('2d');
    tg.setTransform(2,0,0,2,0,0);
    tg.font='400 14px '+MONO;tg.fillStyle=t.accent;
    tg.textBaseline='alphabetic';tg.textAlign='left';
    tg.fillText(sup,0,14);
    var dateW=ctx.measureText(e.date).width;
    ctx.drawImage(tmp,dateX-dateW-14-sw,hy+2-14,sw,sh);
  }
  ctx.textAlign='left';

  /* 正文起点：标准版式下正文+落款整块在剩余空间里垂直居中，
     多出来的留白平分到上下（页眉始终贴顶，落款始终居中收尾）。 */
  var top=HEAD_H+Math.max(0,Math.round(((H-FRAME_M)-L.contentH)/2));
  var y=top+size;

  /* 开引号：单独占左侧一列，正文整体右移，让引号成为构图的一部分 */
  ctx.textAlign='left';
  ctx.fillStyle=t.accent;
  ctx.font='400 '+Math.round(size*1.15)+'px '+SERIF;
  ctx.globalAlpha=.45;
  ctx.fillText('「',BODY_X-6,y-quoteLift(size));
  ctx.globalAlpha=1;

  ctx.fillStyle=t.ink;
  var tx=L.left;
  for(var i=0;i<lines.length;i++){ctx.fillText(lines[i],tx,y+i*lh);}

  /* 闭引号：紧跟末字，与开引号同一字号、同一上提量。
     两处引号必须完全对称——此前这里漏了重设字体：开引号用的是
     size*1.15，画完之后字体被正文的 size 覆盖，闭引号就小了一圈、
     也低了一截，看起来像句末挂着一小撇。 */
  var lastW=ctx.measureText(lines[lines.length-1]).width;
  ctx.fillStyle=t.accent;ctx.globalAlpha=.45;
  ctx.font='400 '+Math.round(size*1.15)+'px '+SERIF;
  ctx.fillText('」',tx+lastW+4,y+(lines.length-1)*lh-quoteLift(size)-quoteSkew(size));
  ctx.globalAlpha=1;

  /* 落款：跟在正文之后，居中。
     分隔线之下依次是书名 / 位置 / 分类，三行间距 26px，
     最后一行基线距图片底边 ≥ 56px，不会压到内框线上。 */
  /* 书名行：作者在前（佚名/缺失时仅书名）。合成整行再统一 fitText，超宽整行缩。 */
  var bookLine=(e.author?e.author+' ':'')+'《'+e.book+'》';
  var ruleY=top+L.blockH+52;
  var footW=F.w-BODY_X*2;
  rule(ctx,cx,ruleY,footW,t.rule);
  ctx.textAlign='center';
  ctx.fillStyle=t.ink2;ctx.font='400 18px '+SERIF;
  ctx.fillText(fitText(ctx,bookLine,footW),cx,ruleY+46);
  ctx.fillStyle=t.ink3;ctx.font='400 13.5px '+MONO;
  ctx.fillText(fitText(ctx,e.loc,footW),cx,ruleY+72);
  ctx.fillStyle=t.accent;ctx.font='400 14.5px '+MONO;
  ctx.fillText(e.cat,cx,ruleY+100);

  ctx.textAlign='left';
}

function fileSafe(s){
  return String(s||'').replace(/[\\/:*?"<>|]/g,'').slice(0,40);
}

/* ---------- 对外：绘制到指定 canvas ---------- */

function draw(canvas,entry,themeKey,formatKey){
  var t=THEME[themeKey]||THEME.paper;
  var F=FORMAT[formatKey]||FORMAT.portrait;
  /* 先用离屏画布量高度，再按最终尺寸落笔 */
  var probe=document.createElement('canvas').getContext('2d');
  var text=String(entry.text||'').replace(/\r/g,'');
  var L=layout(probe,text,F);
  var H=totalH(L,F);

  /* 分辨率：按图高自适应，总像素封顶 9M。
     绝大多数摘录（<600 字）算下来 4M 上下，仍是满 DPR 2；
     只有千字以上的极端长摘录会降到 ~1.7，避免图过长时体积失控。 */
  var budget=9e6;
  var dpr=Math.min(2,Math.max(1.5,window.devicePixelRatio||2));
  if(F.w*H*dpr*dpr>budget)dpr=Math.max(1.2,Math.sqrt(budget/(F.w*H)));

  canvas.width=Math.round(F.w*dpr);canvas.height=Math.round(H*dpr);
  canvas.style.aspectRatio=F.w+' / '+Math.round(H);
  /* 预览缩放：必须同时受「预览台宽」与「预览台高」约束，
     取缩得更多的那个——横版 960 宽按宽缩放后往往比台高还高。 */
  var stageW=Math.max(220,(window.innerWidth-320));
  var stageH=Math.max(220,Math.round((window.innerHeight||900)*0.52));
  var show=Math.min(1,stageW/F.w,stageH/H);
  canvas.style.width=Math.round(F.w*show)+'px';
  canvas.style.height=Math.round(H*show)+'px';
  canvas.style.maxWidth='none';canvas.style.maxHeight='none';

  var ctx=canvas.getContext('2d');
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.textBaseline='alphabetic';
  drawCard(ctx,H,entry,t,F);
  return {w:F.w,h:H};
}

/* 复用页面自己的提示条（app.js 内的 toast 操作的是同一个 DOM 节点） */
function toast(msg){
  var t=document.getElementById('toast');
  if(!t)return;
  t.textContent=msg;t.classList.add('show');
  clearTimeout(t._sh);t._sh=setTimeout(function(){t.classList.remove('show');},2200);
}

/* ---------- 弹层交互 ---------- */
var cur={entry:null,theme:'paper',format:'portrait'};
/* 页面当前底色（app.js 通过 data-skin 挂在 <html> 上），作为分享图的默认背景 */
function skinTheme(){
  var k=document.documentElement.getAttribute('data-skin');
  return THEME[k]?k:'paper';
}

function entryOf(id){
  var get=window.SJIShareCtx;
  return get?get(id):null;
}

function paint(){
  var cv=$('shCanvas');if(!cv||!cur.entry)return;
  var r=draw(cv,cur.entry,cur.theme,cur.format);
  $('shDesc').textContent=(cur.entry.author?cur.entry.author+' · ':'')+'《'+cur.entry.book+'》 · '+cur.entry.loc;
  $('shHint').textContent=THEME[cur.theme].name+' · '+r.w+'×'+r.h;
  /* 背景按钮高亮 */
  THEME_ORDER.forEach(function(k){
    var b=$('th-'+k);
    if(b)b.className='sh-swatch'+(k===cur.theme?' on':'');
  });
  /* 版式按钮高亮 */
  FORMAT_ORDER.forEach(function(k){
    var b=$('fm-'+k);
    if(b)b.className='sh-swatch'+(k===cur.format?' on':'');
  });
  /* 大屏预览同步：把预览画布重画成当前图（zoom 层开着时也要跟手） */
  syncZoom();
}

/* ---------- 大屏预览 ----------
   点预览台的图 → 整屏看；点预览层任意处 → 返回。
   预览画布与主画布同尺寸同内容，纯视觉放大，不再算一遍布局。 */
function zoomIn(){
  if(!cur.entry)return;
  var z=$('shZoomCanvas');if(!z)return;
  z.width=$('shCanvas').width;z.height=$('shCanvas').height;
  z.getContext('2d').drawImage($('shCanvas'),0,0);
  $('shZoomOverlay').classList.add('open');
}
function zoomOut(){
  var o=$('shZoomOverlay');if(o)o.classList.remove('open');
}
function zoomOpen(){
  var o=$('shZoomOverlay');return !!(o&&o.classList.contains('open'));
}
function syncZoom(){
  var o=$('shZoomOverlay');
  if(!o||!o.classList.contains('open'))return;
  var z=$('shZoomCanvas');
  z.width=$('shCanvas').width;z.height=$('shCanvas').height;
  z.getContext('2d').drawImage($('shCanvas'),0,0);
}

function open(id,theme,format){
  var e=entryOf(id);
  if(!e){toast('没有可分享的摘录');return;}
  cur.entry=e;
  cur.theme=theme||skinTheme();
  cur.format=format||'portrait';
  $('shOverlay').classList.add('open');
  paint();
}

function setFormat(k){
  if(!FORMAT[k])return;
  cur.format=k;paint();
}

function setTheme(k){
  if(!THEME[k])return;
  cur.theme=k;paint();
}

/* JPEG 质量：0.9 是「肉眼看不出差别」与「体积明显变小」的平衡点。
   实测（1440×1920）：PNG 2.2MB → q0.9 约 400KB，省 80%；
   降到 0.85 纸纹噪点开始发糊，深色底更容易看出块状痕迹，不值得再省那点。 */
var JPEG_Q=0.9;

/* 图片文件名：书名、底色、版式、日期，一眼能认出来是哪一张 */
function fileName(){
  var f=cur.format==='landscape'?'横版':'竖版';
  return '拾句-'+fileSafe(cur.entry.book)+'-'+THEME[cur.theme].name+'-'+f+'-'+cur.entry.date+'.jpg';
}

function save(){
  var cv=$('shCanvas');if(!cv)return;
  var name=fileName();
  var a=document.createElement('a');
  a.download=name;
  /* toDataURL 在本地文件下也能正常下载，不受 CORS 限制。
     画布是不透明底色（每套主题都先铺满纸底再画），转JPEG 不会出现透明区发黑。 */
  a.href=cv.toDataURL('image/jpeg',JPEG_Q);
  document.body.appendChild(a);a.click();a.remove();
  toast('已保存 '+name);
}

function close(){
  zoomOut();
  $('shOverlay').classList.remove('open');
}

/* 大屏预览交互绑定：点预览台画布开、点预览层任意处回。IIFE 尾部一次性挂好。 */
(function bindZoom(){
  var cv=$('shCanvas');
  if(cv)cv.addEventListener('click',function(){zoomIn();});
  var zo=$('shZoomOverlay');
  if(zo)zo.addEventListener('click',function(){zoomOut();});
})();

/* 跟随页面底色：用户在设置里换了底色后，下一张分享图默认就用同一套配色。
   四个key 与页面 data-skin 一一对应，所以可以直接透传。 */
function syncSkin(k){
  if(!THEME[k])return;
  cur.theme=k;
  if(cur.entry)paint();
}

window.SJIShare={open:open,close:close,theme:setTheme,format:setFormat,save:save,
  syncSkin:syncSkin,
  themes:THEME_ORDER.map(function(k){return {key:k,name:THEME[k].name,bg:THEME[k].bg,accent:THEME[k].accent};}),
  formats:FORMAT_ORDER.map(function(k){return {key:k,w:FORMAT[k].w,h:FORMAT[k].baseH};})};

})();