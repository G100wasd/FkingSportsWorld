/* ---------- 布局交互：分隔条 / icon 导航 ---------- */
const splitter = $("splitter"), panel = $("panel");
splitter.addEventListener("mousedown", e => {
  e.preventDefault();
  splitter.classList.add("drag");
  const move = ev => {
    const target = ev.clientX - panel.offsetLeft;
    panel.style.width = Math.min(560, Math.max(260, target)) + "px";
  };
  const up = () => {
    splitter.classList.remove("drag");
    window.removeEventListener("mousemove", move);
    window.removeEventListener("mouseup", up);
  };
  window.addEventListener("mousemove", move);
  window.addEventListener("mouseup", up);
});

const deck = document.querySelector(".deck");
const marker = document.querySelector(".rail-marker");
const deckCards = [...deck.children];
let curIdx = 0;

const isMobile = () => window.matchMedia("(max-width: 768px)").matches;

// marker 定位：桌面竖排按 offsetTop；手机底部横排按 offsetLeft 居中
function setMarker(icon) {
  marker.style.transform = isMobile()
    ? `translateX(${icon.offsetLeft + icon.offsetWidth / 2 - 8}px)`
    : `translateY(${icon.offsetTop + 10}px)`;
}

function cardH() { return deckCards[curIdx] ? deckCards[curIdx].offsetHeight : 0; }
// 桌面竖排滑动 / 手机横排滑动（横向 deck 时卡片宽 = 面板宽）
function goTo(icon) {
  const idx = deckCards.findIndex(c => c.id === icon.dataset.card);
  if (idx < 0) return;
  const mobile = isMobile();
  if (mobile)
    $("content").classList.add("sheet-up");   // 紧凑模式：切卡必拉起抽屉
  curIdx = idx;
  deck.style.transform = mobile
    ? `translateX(${-idx * deckCards[idx].offsetWidth}px)`
    : `translateY(${-idx * cardH()}px)`;
  setMarker(icon);
  document.querySelectorAll(".rail-ico").forEach(j =>
    j.classList.toggle("active", j === icon));
}
document.querySelectorAll(".rail-ico").forEach(i =>
  i.addEventListener("click", () => goTo(i)));

// 紧凑模式底部抽屉：地图/日志常驻背景；点卡头可拉起/收起
const contentEl = $("content");
document.querySelectorAll(".card-head").forEach(h =>
  h.addEventListener("click", () => {
    if (isMobile()) contentEl.classList.toggle("sheet-up");
  }));
// 卡片底部翻页按钮：按 data-nav 偏移切卡
document.querySelectorAll(".card-foot .btn").forEach(b =>
  b.addEventListener("click", () => {
    const idx = curIdx + (+b.dataset.nav);
    if (idx < 0 || idx >= deckCards.length) return;
    goTo(document.querySelector(
      `.rail-ico[data-card="${deckCards[idx].id}"]`));
  }));
window.addEventListener("resize", () => {
  deck.style.transform = isMobile()
    ? `translateX(${-curIdx * deckCards[curIdx].offsetWidth}px)`
    : `translateY(${-curIdx * cardH()}px)`;
  const act = document.querySelector(".rail-ico.active");
  if (act) setMarker(act);
});
goTo(document.querySelector(".rail-ico.active"));
