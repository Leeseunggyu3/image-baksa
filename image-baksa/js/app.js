/* =====================================================================
   이미지박사 - 이미지 처리 엔진 (100% 클라이언트 사이드)
   업로드한 사진은 절대 서버로 전송되지 않습니다. 모든 처리는
   사용자의 브라우저(Canvas API) 안에서만 이루어집니다.
   ===================================================================== */
(function () {
  "use strict";

  /* ---------- 전역 상태 ---------- */
  var state = {
    source: null,   // 그릴 수 있는 원본 (ImageBitmap 또는 HTMLImageElement)
    objURL: null,   // 미리보기용 object URL
    name: "",       // 원본 파일명 (확장자 제외)
    ext: "png",     // 원본 확장자
    mime: "image/png",
    width: 0,
    height: 0,
    size: 0         // 원본 바이트 수
  };

  /* ---------- 유틸 ---------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function formatBytes(bytes) {
    if (!bytes && bytes !== 0) return "-";
    if (bytes < 1024) return bytes + " B";
    var kb = bytes / 1024;
    if (kb < 1024) return kb.toFixed(1) + " KB";
    return (kb / 1024).toFixed(2) + " MB";
  }

  function baseName(filename) {
    var dot = filename.lastIndexOf(".");
    return dot > 0 ? filename.slice(0, dot) : filename;
  }
  function extOf(filename) {
    var dot = filename.lastIndexOf(".");
    return dot > 0 ? filename.slice(dot + 1).toLowerCase() : "png";
  }

  function mimeFor(fmt) {
    fmt = (fmt || "").toLowerCase();
    if (fmt === "jpg" || fmt === "jpeg") return "image/jpeg";
    if (fmt === "webp") return "image/webp";
    return "image/png";
  }

  /* 캔버스에 원본을 지정 크기로 그려서 반환 (JPEG일 때 흰 배경 채움) */
  function renderCanvas(w, h, mime, sx, sy, sw, sh) {
    var canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(w));
    canvas.height = Math.max(1, Math.round(h));
    var ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    if (mime === "image/jpeg") {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    if (sx === undefined) {
      ctx.drawImage(state.source, 0, 0, canvas.width, canvas.height);
    } else {
      ctx.drawImage(state.source, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    }
    return canvas;
  }

  function canvasToBlob(canvas, mime, quality) {
    return new Promise(function (resolve, reject) {
      if (canvas.toBlob) {
        canvas.toBlob(function (blob) {
          blob ? resolve(blob) : reject(new Error("이미지 변환에 실패했습니다."));
        }, mime, quality);
      } else {
        try {
          var data = canvas.toDataURL(mime, quality);
          var bin = atob(data.split(",")[1]);
          var arr = new Uint8Array(bin.length);
          for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
          resolve(new Blob([arr], { type: mime }));
        } catch (e) { reject(e); }
      }
    });
  }

  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  /* 결과 박스에 미리보기/메타/다운로드 출력 */
  function showResult(panel, blob, w, h, suffix, fmt) {
    var box = $(".result-box", panel);
    if (!box) return;
    var url = URL.createObjectURL(blob);
    var saved = state.size ? Math.round((1 - blob.size / state.size) * 100) : 0;
    var savedHtml = "";
    if (state.size && blob.size < state.size) {
      savedHtml = ' <span class="badge save">▼ ' + saved + "% 절약</span>";
    } else if (state.size && blob.size > state.size) {
      savedHtml = ' <span class="badge">▲ ' + Math.abs(saved) + "% 증가</span>";
    }
    var fname = state.name + suffix + "." + (fmt === "jpeg" ? "jpg" : fmt);
    box.innerHTML =
      '<h4>결과 미리보기</h4>' +
      '<img src="' + url + '" alt="결과 이미지">' +
      '<div class="meta"><b>' + w + " × " + h + ' px</b> · ' +
      formatBytes(blob.size) + savedHtml + '<br>' +
      '<span style="color:#777">' + fname + '</span></div>';
    var btn = $(".download-btn", panel);
    btn.disabled = false;
    btn.onclick = function () { downloadBlob(blob, fname); };
    setStatus("완료: " + w + "×" + h + "px, " + formatBytes(blob.size));
  }

  function setStatus(msg) {
    var el = $("#statusMsg");
    if (el) el.textContent = msg;
  }

  /* ---------- 파일 로딩 ---------- */
  function handleFiles(files) {
    if (!files || !files.length) return;
    var file = files[0];
    if (!/^image\//.test(file.type) && !/\.(png|jpe?g|webp|gif|bmp)$/i.test(file.name)) {
      alert("이미지 파일(PNG, JPG, WebP 등)만 업로드할 수 있어요.");
      return;
    }
    if (state.objURL) URL.revokeObjectURL(state.objURL);

    state.name = baseName(file.name);
    state.ext = extOf(file.name);
    state.mime = file.type || mimeFor(state.ext);
    state.size = file.size;
    state.objURL = URL.createObjectURL(file);

    var done = function (drawable, w, h) {
      state.source = drawable;
      state.width = w;
      state.height = h;
      onImageLoaded();
    };

    if (window.createImageBitmap) {
      createImageBitmap(file, { imageOrientation: "from-image" })
        .then(function (bmp) { done(bmp, bmp.width, bmp.height); })
        .catch(function () { loadViaImg(done); });
    } else {
      loadViaImg(done);
    }
  }

  function loadViaImg(done) {
    var img = new Image();
    img.onload = function () { done(img, img.naturalWidth, img.naturalHeight); };
    img.onerror = function () { alert("이미지를 불러오지 못했어요. 다른 파일로 시도해 주세요."); };
    img.src = state.objURL;
  }

  function onImageLoaded() {
    // 원본 미리보기 + 메타
    $all(".original-preview").forEach(function (box) {
      box.innerHTML =
        '<h4>원본</h4>' +
        '<img src="' + state.objURL + '" alt="원본 이미지">' +
        '<div class="meta"><b>' + state.width + " × " + state.height + ' px</b> · ' +
        formatBytes(state.size) + '<br><span style="color:#777">' +
        state.name + "." + state.ext + '</span></div>';
    });
    // 드롭존 텍스트 갱신
    $all(".dz-loaded").forEach(function (el) { el.textContent = state.name + "." + state.ext; });
    document.body.classList.add("has-image");
    $all(".needs-image").forEach(function (el) { el.disabled = false; });

    // 리사이즈 기본값
    var rw = $("#resizeW"), rh = $("#resizeH");
    if (rw && rh) { rw.value = state.width; rh.value = state.height; }
    $all(".result-box").forEach(function (b) { b.innerHTML = '<h4>결과 미리보기</h4><div class="meta" style="color:#999">아직 처리 전이에요.</div>'; });
    $all(".download-btn").forEach(function (b) { b.disabled = true; });

    // 자르기 탭이 열려 있으면 초기화
    if ($("#panel-crop").classList.contains("active")) initCrop();

    setStatus("불러옴: " + state.name + "." + state.ext + " (" + state.width + "×" + state.height + ")");
  }

  function requireImage() {
    if (!state.source) { alert("먼저 이미지를 업로드해 주세요!"); return false; }
    return true;
  }

  /* ---------- 1) 크기 조절 ---------- */
  function setupResize() {
    var panel = $("#panel-resize");
    var w = $("#resizeW"), h = $("#resizeH"), lock = $("#resizeLock");
    var pct = $("#resizePct");
    var ratio = function () { return state.width && state.height ? state.width / state.height : 1; };

    w.addEventListener("input", function () {
      if (lock.checked && w.value) h.value = Math.round(w.value / ratio());
    });
    h.addEventListener("input", function () {
      if (lock.checked && h.value) w.value = Math.round(h.value * ratio());
    });
    pct.addEventListener("input", function () {
      if (!state.width) return;
      var p = Math.max(1, parseInt(pct.value, 10) || 100) / 100;
      w.value = Math.round(state.width * p);
      h.value = Math.round(state.height * p);
    });

    $(".run", panel).addEventListener("click", function () {
      if (!requireImage()) return;
      var ow = parseInt(w.value, 10), oh = parseInt(h.value, 10);
      if (!ow || !oh || ow < 1 || oh < 1) { alert("올바른 가로/세로 값을 입력해 주세요."); return; }
      var fmt = $("#resizeFmt").value;
      var mime = mimeFor(fmt);
      var q = mime === "image/png" ? undefined : 0.92;
      var canvas = renderCanvas(ow, oh, mime);
      canvasToBlob(canvas, mime, q).then(function (blob) {
        showResult(panel, blob, ow, oh, "_" + ow + "x" + oh, fmt);
      }).catch(function (e) { alert(e.message); });
    });
  }

  /* ---------- 2) 용량 압축 ---------- */
  function setupCompress() {
    var panel = $("#panel-compress");
    var q = $("#compQuality"), qv = $("#compQualityVal");
    q.addEventListener("input", function () { qv.textContent = q.value + "%"; });

    $(".run", panel).addEventListener("click", function () {
      if (!requireImage()) return;
      var fmt = $("#compFmt").value;          // jpeg | webp
      var mime = mimeFor(fmt);
      var quality = (parseInt(q.value, 10) || 80) / 100;
      var scale = (parseInt($("#compScale").value, 10) || 100) / 100;
      var ow = Math.round(state.width * scale);
      var oh = Math.round(state.height * scale);
      var canvas = renderCanvas(ow, oh, mime);
      canvasToBlob(canvas, mime, quality).then(function (blob) {
        showResult(panel, blob, ow, oh, "_compressed", fmt);
      }).catch(function (e) { alert(e.message); });
    });
  }

  /* ---------- 3) 포맷 변환 ---------- */
  function setupConvert() {
    var panel = $("#panel-convert");
    $(".run", panel).addEventListener("click", function () {
      if (!requireImage()) return;
      var fmt = $("#convFmt").value;          // png | jpeg | webp
      var mime = mimeFor(fmt);
      var q = mime === "image/png" ? undefined : (parseInt($("#convQuality").value, 10) || 92) / 100;
      var canvas = renderCanvas(state.width, state.height, mime);
      canvasToBlob(canvas, mime, q).then(function (blob) {
        showResult(panel, blob, state.width, state.height, "_" + (fmt === "jpeg" ? "jpg" : fmt), fmt);
      }).catch(function (e) { alert(e.message); });
    });
    // png는 품질 비활성
    var cf = $("#convFmt"), cq = $("#convQuality");
    var toggleQ = function () { cq.disabled = (cf.value === "png"); };
    cf.addEventListener("change", toggleQ); toggleQ();
  }

  /* ---------- 4) 자르기 (인터랙티브) ---------- */
  var crop = { canvas: null, ctx: null, scale: 1, rect: null, drag: null };

  function initCrop() {
    var stage = $("#cropStage");
    var rectEl = $("#cropRect");
    if (!state.source) {
      stage.style.display = "none";
      $("#cropHint").style.display = "block";
      return;
    }
    $("#cropHint").style.display = "none";
    stage.style.display = "inline-block";

    var maxW = Math.min(560, stage.parentElement.clientWidth - 4 || 560);
    var dispW = Math.min(state.width, maxW);
    var dispH = Math.round(state.height * (dispW / state.width));
    crop.scale = state.width / dispW;

    var canvas = $("#cropCanvas");
    canvas.width = dispW;
    canvas.height = dispH;
    var ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, dispW, dispH);
    ctx.drawImage(state.source, 0, 0, dispW, dispH);
    crop.canvas = canvas;

    // 기본 선택영역: 가운데 70%
    var rw = Math.round(dispW * 0.7), rh = Math.round(dispH * 0.7);
    crop.rect = { x: Math.round((dispW - rw) / 2), y: Math.round((dispH - rh) / 2), w: rw, h: rh };
    drawCropRect();
    updateCropInfo();

    if (!stage._bound) { bindCrop(stage, rectEl); stage._bound = true; }
  }

  function drawCropRect() {
    var r = crop.rect, el = $("#cropRect");
    el.style.left = r.x + "px";
    el.style.top = r.y + "px";
    el.style.width = r.w + "px";
    el.style.height = r.h + "px";
    el.style.display = "block";
  }

  function updateCropInfo() {
    var r = crop.rect;
    $("#cropInfo").textContent =
      "선택 영역: " + Math.round(r.w * crop.scale) + " × " + Math.round(r.h * crop.scale) + " px";
  }

  function clampRect() {
    var r = crop.rect, cw = crop.canvas.width, ch = crop.canvas.height;
    r.w = Math.max(10, Math.min(r.w, cw));
    r.h = Math.max(10, Math.min(r.h, ch));
    r.x = Math.max(0, Math.min(r.x, cw - r.w));
    r.y = Math.max(0, Math.min(r.y, ch - r.h));
  }

  function bindCrop(stage, rectEl) {
    var startPointer = function (e) {
      e.preventDefault();
      var pt = pointer(e, crop.canvas);
      var target = e.target;
      var mode = "new";
      if (target.classList && target.classList.contains("handle")) {
        mode = target.className.split(" ").pop(); // nw/ne/sw/se
      } else if (target === rectEl) {
        mode = "move";
      }
      crop.drag = { mode: mode, sx: pt.x, sy: pt.y, orig: Object.assign({}, crop.rect) };
      if (mode === "new") {
        crop.rect = { x: pt.x, y: pt.y, w: 0, h: 0 };
        drawCropRect();
      }
      window.addEventListener("pointermove", movePointer);
      window.addEventListener("pointerup", endPointer);
    };
    var movePointer = function (e) {
      if (!crop.drag) return;
      var pt = pointer(e, crop.canvas);
      var d = crop.drag, dx = pt.x - d.sx, dy = pt.y - d.sy, o = d.orig, r = crop.rect;
      if (d.mode === "move") {
        r.x = o.x + dx; r.y = o.y + dy;
      } else if (d.mode === "new") {
        r.x = Math.min(d.sx, pt.x); r.y = Math.min(d.sy, pt.y);
        r.w = Math.abs(pt.x - d.sx); r.h = Math.abs(pt.y - d.sy);
      } else {
        if (d.mode.indexOf("e") >= 0) r.w = o.w + dx;
        if (d.mode.indexOf("s") >= 0) r.h = o.h + dy;
        if (d.mode.indexOf("w") >= 0) { r.x = o.x + dx; r.w = o.w - dx; }
        if (d.mode.indexOf("n") >= 0) { r.y = o.y + dy; r.h = o.h - dy; }
      }
      clampRect(); drawCropRect(); updateCropInfo();
    };
    var endPointer = function () {
      crop.drag = null;
      window.removeEventListener("pointermove", movePointer);
      window.removeEventListener("pointerup", endPointer);
    };
    stage.addEventListener("pointerdown", startPointer);
  }

  function pointer(e, canvas) {
    var rect = canvas.getBoundingClientRect();
    var sx = canvas.width / rect.width, sy = canvas.height / rect.height;
    return { x: (e.clientX - rect.left) * sx, y: (e.clientY - rect.top) * sy };
  }

  function setupCrop() {
    var panel = $("#panel-crop");
    // 비율 프리셋
    $all("[data-ratio]", panel).forEach(function (b) {
      b.addEventListener("click", function () {
        if (!requireImage() || !crop.canvas) return;
        var parts = b.getAttribute("data-ratio").split(":");
        var cw = crop.canvas.width, ch = crop.canvas.height;
        if (parts[0] === "free") { return; }
        var ar = parseFloat(parts[0]) / parseFloat(parts[1]);
        var w = cw, h = w / ar;
        if (h > ch) { h = ch; w = h * ar; }
        crop.rect = { x: (cw - w) / 2, y: (ch - h) / 2, w: w, h: h };
        clampRect(); drawCropRect(); updateCropInfo();
      });
    });

    $(".run", panel).addEventListener("click", function () {
      if (!requireImage()) return;
      if (!crop.rect || crop.rect.w < 5 || crop.rect.h < 5) { alert("자를 영역을 드래그해서 선택해 주세요."); return; }
      var s = crop.scale, r = crop.rect;
      var sx = Math.round(r.x * s), sy = Math.round(r.y * s);
      var sw = Math.round(r.w * s), sh = Math.round(r.h * s);
      var fmt = $("#cropFmt").value;
      var mime = mimeFor(fmt);
      var q = mime === "image/png" ? undefined : 0.92;
      var canvas = renderCanvas(sw, sh, mime, sx, sy, sw, sh);
      canvasToBlob(canvas, mime, q).then(function (blob) {
        showResult(panel, blob, sw, sh, "_cropped", fmt);
      }).catch(function (e) { alert(e.message); });
    });
  }

  /* ---------- 탭 ---------- */
  function setupTabs() {
    $all(".tab").forEach(function (tab) {
      tab.addEventListener("click", function () {
        var id = tab.getAttribute("data-tab");
        $all(".tab").forEach(function (t) { t.classList.toggle("active", t === tab); });
        $all(".tab-panel").forEach(function (p) {
          p.classList.toggle("active", p.id === "panel-" + id);
        });
        if (id === "crop") initCrop();
      });
    });
  }

  /* ---------- 드롭존 / 파일 입력 ---------- */
  function setupUpload() {
    var dz = $("#dropzone"), input = $("#fileInput");
    if (!dz) return;
    dz.addEventListener("click", function () { input.click(); });
    dz.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); }
    });
    input.addEventListener("change", function () { handleFiles(input.files); });
    ["dragenter", "dragover"].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add("dragover"); });
    });
    ["dragleave", "drop"].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove("dragover"); });
    });
    dz.addEventListener("drop", function (e) {
      if (e.dataTransfer && e.dataTransfer.files) handleFiles(e.dataTransfer.files);
    });
    // 전체 페이지에 드롭 방지(파일이 새 탭으로 열리는 것 방지)
    window.addEventListener("dragover", function (e) { e.preventDefault(); });
    window.addEventListener("drop", function (e) { e.preventDefault(); });
  }

  /* ---------- 작업표시줄 시계 ---------- */
  function setupClock() {
    var el = $("#tbClock");
    if (!el) return;
    var tick = function () {
      var d = new Date();
      var h = d.getHours(), m = d.getMinutes();
      var ap = h < 12 ? "오전" : "오후";
      var hh = h % 12; if (hh === 0) hh = 12;
      el.textContent = ap + " " + hh + ":" + (m < 10 ? "0" + m : m);
    };
    tick(); setInterval(tick, 15000);
  }

  /* ---------- 시작 ---------- */
  document.addEventListener("DOMContentLoaded", function () {
    setupClock();
    if (!$("#dropzone")) return; // 도구가 없는 정적 페이지면 종료
    setupUpload();
    setupTabs();
    setupResize();
    setupCompress();
    setupConvert();
    setupCrop();
    window.addEventListener("resize", function () {
      if ($("#panel-crop").classList.contains("active")) initCrop();
    });
  });
})();
