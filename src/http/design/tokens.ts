// The Legacy Vault visual language, as one inlined stylesheet.
//
// Why inline, server-rendered CSS and not a framework: every surface here is
// reached at someone's worst moment — a panicking user at 2am, a recipient
// opening a message from someone who has died. It must render instantly, work
// with no JavaScript, survive a strict Content-Security-Policy, and never depend
// on a CDN font that might not load. So the whole system is one static string
// with a system-font stack. A template cannot hallucinate; a static stylesheet
// cannot fail to download.
//
// The look is deliberately NOT generic SaaS. No hero gradient, no glassmorphism,
// no emoji bullets, no drop-shadow card soup. The reference is a records office:
// warm paper, near-black ink, hairline rules, small-caps monospace labels,
// numbered sections like a legal instrument, one restrained accent. Evergreen is
// the colour of the *safe* direction (alive, reset, cancel); amber is the colour
// of a hold that wants attention. Alarm red never appears on the death path —
// the product is calm, because being wrong is worse than being slow.

/**
 * The design tokens and component styles. Emitted once per page, inside a
 * `<style>` in the head. Dark mode follows the OS by default and can be pinned
 * with `data-theme` on the root (progressive enhancement only — the page is
 * fully usable with the default theme and no script).
 */
export const BASE_CSS = `
:root{
  --paper:#f3efe4; --surface:#fbf9f2; --raise:#ffffff;
  --ink:#181510; --ink-soft:#4f4739; --muted:#726957; --faint:#8d836e;
  --rule:#ddd4c0; --rule-strong:#c4b9a0;
  --go:#1f5236; --go-ink:#f5f1e6; --go-soft:#e4ece2;
  --hold:#8f5313; --hold-soft:#f4e7d3;
  --link:#1f5236; --focus:#1f5236;
  --measure:34rem; --page:66rem;
  --serif:"Iowan Old Style","Palatino Linotype",Palatino,"Book Antiqua",Georgia,serif;
  --sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,system-ui,sans-serif;
  --mono:ui-monospace,"SF Mono","JetBrains Mono","Roboto Mono",Menlo,Consolas,monospace;
}
:root[data-theme="dark"], :root.theme-dark{
  --paper:#121009; --surface:#1b1811; --raise:#221f16;
  --ink:#efe8d7; --ink-soft:#cfc6b1; --muted:#a99e86; --faint:#877d68;
  --rule:#332e22; --rule-strong:#463f2f;
  --go:#74b18b; --go-ink:#0f130f; --go-soft:#1d2a1f;
  --hold:#d59a52; --hold-soft:#2a2113;
  --link:#9ec8ac; --focus:#74b18b;
}
@media (prefers-color-scheme:dark){
  :root:not([data-theme="light"]):not(.theme-light){
    --paper:#121009; --surface:#1b1811; --raise:#221f16;
    --ink:#efe8d7; --ink-soft:#cfc6b1; --muted:#a99e86; --faint:#877d68;
    --rule:#332e22; --rule-strong:#463f2f;
    --go:#74b18b; --go-ink:#0f130f; --go-soft:#1d2a1f;
    --hold:#d59a52; --hold-soft:#2a2113;
    --link:#9ec8ac; --focus:#74b18b;
  }
}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{
  margin:0; background:var(--paper); color:var(--ink);
  font-family:var(--sans); font-size:17px; line-height:1.6;
  font-feature-settings:"kern" 1,"liga" 1;
  text-rendering:optimizeLegibility; -webkit-font-smoothing:antialiased;
}
a{color:var(--link); text-underline-offset:2px; text-decoration-thickness:1px}
a:hover{text-decoration-thickness:2px}
:focus-visible{outline:2px solid var(--focus); outline-offset:3px; border-radius:1px}
h1,h2,h3{font-family:var(--serif); font-weight:600; line-height:1.12; letter-spacing:-.01em; color:var(--ink)}
h1{font-size:clamp(2.1rem,5vw,3.3rem); margin:.1em 0 .35em}
h2{font-size:clamp(1.4rem,3vw,1.9rem); margin:2.4em 0 .5em}
h3{font-size:1.15rem; margin:1.8em 0 .4em}
p{margin:0 0 1.05em}
hr{border:0; border-top:1px solid var(--rule); margin:2.2rem 0}
small{font-size:.82rem}
strong{font-weight:650}
::selection{background:var(--go); color:var(--go-ink)}

/* ---- layout ------------------------------------------------------------ */
.page{min-height:100vh; display:flex; flex-direction:column}
.wrap{width:100%; max-width:var(--page); margin:0 auto; padding:0 clamp(1.1rem,4vw,2.4rem)}
.measure{max-width:var(--measure)}
.grow{flex:1 0 auto}
.stack>*+*{margin-top:1.05em}
.lede{font-family:var(--serif); font-size:clamp(1.15rem,2.4vw,1.45rem); line-height:1.42; color:var(--ink-soft)}

/* ---- eyebrow / kicker -------------------------------------------------- */
.eyebrow{font-family:var(--mono); font-size:.72rem; letter-spacing:.22em; text-transform:uppercase; color:var(--muted); margin:0 0 .6rem; display:flex; align-items:center; gap:.7rem}
.eyebrow::before{content:""; width:1.6rem; height:1px; background:var(--rule-strong)}
.eyebrow.plain::before{display:none}

/* ---- header / footer --------------------------------------------------- */
.masthead{border-bottom:1px solid var(--rule); background:var(--surface)}
.masthead .bar{display:flex; align-items:center; justify-content:space-between; gap:1rem; padding:.95rem 0; flex-wrap:wrap}
.brand{display:inline-flex; align-items:baseline; gap:.6rem; font-family:var(--serif); font-weight:600; font-size:1.15rem; color:var(--ink); text-decoration:none; letter-spacing:-.01em}
.brand .mark{font-family:var(--mono); font-size:.66rem; letter-spacing:.2em; text-transform:uppercase; color:var(--go); border:1px solid var(--rule-strong); border-radius:2px; padding:.16rem .4rem; transform:translateY(-1px)}
.nav{display:flex; gap:1.3rem; align-items:center; flex-wrap:wrap}
.nav a{color:var(--ink-soft); text-decoration:none; font-size:.92rem}
.nav a:hover{color:var(--ink); text-decoration:underline}
.roomtag{font-family:var(--mono); font-size:.68rem; letter-spacing:.14em; text-transform:uppercase; color:var(--faint)}
.foot{border-top:1px solid var(--rule); background:var(--surface); margin-top:4rem; padding:2.2rem 0; color:var(--muted); font-size:.9rem}
.foot .cols{display:flex; gap:2.4rem; flex-wrap:wrap; justify-content:space-between}
.foot a{color:var(--ink-soft); text-decoration:none}
.foot a:hover{text-decoration:underline}
.foot .fine{margin-top:1.6rem; padding-top:1.2rem; border-top:1px solid var(--rule); font-size:.8rem; color:var(--faint)}

/* ---- panels ------------------------------------------------------------ */
.panel{background:var(--surface); border:1px solid var(--rule); border-radius:3px; padding:clamp(1.1rem,3vw,1.9rem)}
.panel+.panel{margin-top:1.1rem}
.panel--raise{background:var(--raise)}
.panel--go{border-color:var(--go); background:var(--go-soft)}
.panel--hold{border-left:3px solid var(--hold); background:var(--hold-soft)}
.panel .h{font-family:var(--serif); font-size:1.2rem; margin:0 0 .5rem}

/* ---- section numbering (legal-instrument feel) ------------------------- */
.doc-section{display:grid; grid-template-columns:2.6rem 1fr; gap:1rem; padding:1.6rem 0; border-top:1px solid var(--rule)}
.doc-section .n{font-family:var(--mono); font-size:.85rem; color:var(--go); padding-top:.35rem}
.doc-section h2{margin:.1rem 0 .4rem; font-size:1.3rem}

/* ---- ledger table ------------------------------------------------------ */
.ledger{width:100%; border-collapse:collapse; font-size:.94rem}
.ledger caption{text-align:left; font-family:var(--mono); font-size:.72rem; letter-spacing:.16em; text-transform:uppercase; color:var(--muted); padding-bottom:.6rem}
.ledger th,.ledger td{text-align:left; padding:.7rem .7rem; border-bottom:1px solid var(--rule); vertical-align:top}
.ledger th{font-family:var(--mono); font-weight:500; font-size:.72rem; letter-spacing:.1em; text-transform:uppercase; color:var(--muted)}
.ledger td .sub{display:block; color:var(--muted); font-size:.84rem}
.ledger tr:last-child td{border-bottom:0}
.num{font-family:var(--mono); font-variant-numeric:tabular-nums}

/* ---- buttons / actions ------------------------------------------------- */
.act{display:inline-flex; align-items:center; justify-content:center; gap:.5rem; font-family:var(--sans); font-size:1rem; font-weight:600; line-height:1; padding:.85rem 1.4rem; border-radius:3px; border:1px solid transparent; cursor:pointer; text-decoration:none; transition:transform .04s ease}
.act:active{transform:translateY(1px)}
.act--go{background:var(--go); color:var(--go-ink); border-color:var(--go)}
.act--go:hover{filter:brightness(1.06)}
.act--ghost{background:transparent; color:var(--ink); border-color:var(--rule-strong)}
.act--ghost:hover{border-color:var(--ink); background:var(--surface)}
.act--quiet{background:transparent; color:var(--ink-soft); border-color:transparent; padding-left:0; padding-right:0}
.act--quiet:hover{color:var(--ink); text-decoration:underline}
.act[disabled],.act.is-disabled{opacity:.5; cursor:not-allowed; pointer-events:none}
.actions{display:flex; gap:.8rem; flex-wrap:wrap; align-items:center}

/* The panic controls — check-in and cancel. Largest, highest-contrast, one-
   handed. These two classes are the whole reason the palette exists. */
.panic{display:block; width:100%; text-align:center; font-family:var(--sans); font-weight:700;
  font-size:clamp(1.25rem,3.6vw,1.7rem); line-height:1.15; padding:1.5rem 1.2rem; border-radius:5px;
  border:2px solid var(--go); background:var(--go); color:var(--go-ink); cursor:pointer;
  letter-spacing:-.01em; box-shadow:0 1px 0 var(--rule-strong)}
.panic:hover{filter:brightness(1.05)}
.panic:active{transform:translateY(1px)}
.panic .hint{display:block; font-size:.9rem; font-weight:500; opacity:.85; margin-top:.4rem; letter-spacing:0}
.panic-form{margin:0}

/* ---- state banner ------------------------------------------------------ */
.banner{display:flex; gap:1rem; align-items:flex-start; border:1px solid var(--rule); border-left-width:4px; border-radius:3px; padding:1rem 1.2rem; background:var(--surface)}
.banner .dot{width:.7rem; height:.7rem; border-radius:50%; margin-top:.5rem; flex:0 0 auto; background:var(--muted)}
.banner .t{font-family:var(--serif); font-size:1.15rem; margin:0 0 .15rem}
.banner .s{color:var(--muted); font-size:.92rem; margin:0}
.banner--ok{border-left-color:var(--go)} .banner--ok .dot{background:var(--go)}
.banner--watch{border-left-color:var(--hold)} .banner--watch .dot{background:var(--hold)}
.banner--hold{border-left-color:var(--hold); background:var(--hold-soft)} .banner--hold .dot{background:var(--hold)}

/* ---- chips / meta ------------------------------------------------------ */
.chip{display:inline-flex; align-items:center; gap:.35rem; font-family:var(--mono); font-size:.7rem; letter-spacing:.08em; text-transform:uppercase; padding:.24rem .55rem; border:1px solid var(--rule-strong); border-radius:2px; color:var(--muted)}
.chip--go{color:var(--go); border-color:var(--go)}
.chip--hold{color:var(--hold); border-color:var(--hold)}
.chip--pending{color:var(--faint)}

/* ---- quorum meter ------------------------------------------------------ */
.groups{display:flex; gap:.6rem; flex-wrap:wrap; margin:.6rem 0}
.group-pip{flex:1 1 0; min-width:6rem; border:1px solid var(--rule-strong); border-radius:3px; padding:.6rem .7rem; background:var(--surface)}
.group-pip.met{border-color:var(--go); background:var(--go-soft)}
.group-pip .g{font-family:var(--mono); font-size:.68rem; letter-spacing:.12em; text-transform:uppercase; color:var(--muted)}
.group-pip .v{font-family:var(--serif); font-size:1.05rem; margin-top:.15rem}
.group-pip.met .v{color:var(--go)}

/* ---- forms ------------------------------------------------------------- */
label.field{display:block; margin:0 0 1rem}
label.field .lab{display:block; font-family:var(--mono); font-size:.72rem; letter-spacing:.1em; text-transform:uppercase; color:var(--muted); margin-bottom:.4rem}
input[type=text],input[type=email],input[type=tel],input[type=password],input[type=number],select,textarea{
  width:100%; font-family:var(--sans); font-size:1rem; color:var(--ink); background:var(--raise);
  border:1px solid var(--rule-strong); border-radius:3px; padding:.7rem .8rem}
input:focus,select:focus,textarea:focus{border-color:var(--go); outline:2px solid transparent}
.code-input{font-family:var(--mono); font-size:1.6rem; letter-spacing:.4em; text-align:center}

/* ---- misc -------------------------------------------------------------- */
.kv{display:grid; grid-template-columns:auto 1fr; gap:.3rem 1.1rem; font-size:.94rem}
.kv dt{font-family:var(--mono); font-size:.72rem; letter-spacing:.08em; text-transform:uppercase; color:var(--muted); padding-top:.15rem}
.kv dd{margin:0}
.tag-row{display:flex; gap:.5rem; flex-wrap:wrap; align-items:center}
.spacer{height:2.4rem}
.center{text-align:center}
.quiet{color:var(--muted)}
.serif{font-family:var(--serif)}

/* ---- cookie banner ----------------------------------------------------- */
.cookie{position:fixed; left:0; right:0; bottom:0; z-index:50; background:var(--raise); border-top:1px solid var(--rule-strong)}
.cookie .in{display:flex; gap:1rem; align-items:center; justify-content:space-between; flex-wrap:wrap; padding:.9rem 0}
.cookie p{margin:0; font-size:.88rem; color:var(--ink-soft); max-width:44rem}
@media (max-width:640px){
  .doc-section{grid-template-columns:1fr; gap:.2rem}
  .doc-section .n{padding-top:0}
  .nav{gap:.9rem}
}
@media (prefers-reduced-motion:reduce){*{transition:none !important}}
`;

/**
 * A tiny, optional progressive-enhancement script: it lets a viewer pin the
 * theme and dismiss the cookie note. The page is fully usable if this never
 * runs (no-JS, CSP without inline-script). It never touches product state — no
 * check-in, no cancel goes through JavaScript.
 */
export const ENHANCE_JS = `
(function(){try{
  var r=document.documentElement;
  var t=localStorage.getItem('lv-theme'); if(t){r.setAttribute('data-theme',t);}
  var btn=document.querySelector('[data-theme-toggle]');
  if(btn){btn.addEventListener('click',function(){
    var cur=r.getAttribute('data-theme');
    var next=cur==='dark'?'light':(cur==='light'?'dark':(matchMedia('(prefers-color-scheme:dark)').matches?'light':'dark'));
    r.setAttribute('data-theme',next); try{localStorage.setItem('lv-theme',next);}catch(e){}
  });}
  var c=document.querySelector('[data-cookie]');
  if(c){ if(localStorage.getItem('lv-cookie')==='1'){c.remove();}
    var ok=c.querySelector('[data-cookie-ok]');
    if(ok){ok.addEventListener('click',function(){try{localStorage.setItem('lv-cookie','1');}catch(e){} c.remove();});}
  }
}catch(e){}})();
`;
