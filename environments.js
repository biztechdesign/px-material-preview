/* ---------------------------------------------------------------------------
   Material viewer - environment & tone setup.        (edit CONFIG, ship as-is)

   WHAT THE CLIENT SEES ON OPEN: the environment, light level and tone curve
   set in CONFIG below. Adjust with the on-page controls until it looks right,
   then copy the numbers into CONFIG and deliver.

   ADDING AN HDR (.hdr only, RGBELoader - no .exr):
     1. drop the file into  assets\environments\
     2. run:  python make_env_manifest.py   (rewrites environments.json)
     3. refresh / redeploy
   On a server with folder listings (python -m http.server) step 2 is optional:
   the picker also reads the listing. Real web servers usually have no
   listings, which is why the manifest exists - do not skip it for delivery.

   NICE_NAMES gives a file a label; files without one get a name made from the
   filename. The FIRST NICE_NAMES entry that exists is the default environment.
   Every failure falls back safely (manifest -> listing -> built-in list), so
   nothing here can leave a blank page.
--------------------------------------------------------------------------- */
(function () {
  var CONFIG = {
    light: 1.0,        // environment intensity on open (app's old fixed value: 2)
    trueColor: true,   // Khronos PBR Neutral tone mapping on open
    // canvas backdrop behind the product. The app's own clear colour is #F2F2F2,
    // which near-white materials disappear into; this soft grey vignette keeps
    // them readable. Any CSS background value works; null = keep the app's.
    // white-and-grey only, to match the PX Designer Tool palette: white centre
    // falling to a neutral grey edge - no colour tint anywhere.
    backdrop: "radial-gradient(circle at 50% 35%, #ffffff 0%, #ededed 50%, #cccccc 100%)",
    // soft contact shadow under the product (fake AO). 0 = off; 0.3-0.5 typical.
    groundShadow: 0.4,
    // how much of the tile's height the product fills on open (0.5..0.95)
    fit: 0.7,
    // stop the orbit at the floor (true) - below it the contact shadow plane is
    // seen edge-on as a hard line. false = free orbit.
    floorLock: true,
    // true = full bar, "env" = environment dropdown only (tuning stays
    // internal), false = locked look with no bar at all
    showControls: false,
    // closure vs body separation when both wear the same finish (client
    // feedback 2026-09-11). Closure meshes (name matches /closure|cap/i) get a
    // sibling material: roughness bumped by capRoughness, and the colour value
    // pushed toward mid-grey by capShift (dark finishes lighten, light finishes
    // darken). Real caps are knurled and read rougher than bodies in every
    // catalogue photo, so this is the physically honest cue. 0 = off.
    capRoughness: 0.14,
    capShift: 0.09,
    // clear finishes (transmission > flagThreshold, or alpha glass with
    // opacity < 0.5) reflect the studio's bright
    // side walls at grazing angles and read as a white ghost. Product
    // photographers fix this with black flags either side of a clear bottle;
    // the same is done here on a copy of the HDR used only by those tiles.
    // flagDark = brightness left in the flagged band (0 = pure black flags),
    // flagWidth = fraction of the panorama width each flag covers (0..0.5),
    // flagBand = vertical band as [top, bottom] fractions of the panorama height.
    flagThreshold: 0.8,
    flagDark: 0.10,
    flagWidth: 0.50,
    flagBand: [0.40, 0.80]
  };

  var NICE_NAMES = {
    "studio_small_09_1k.hdr": "Studio",
    "neutral_studio.hdr": "Neutral Studio (true color)",
    "studio_small_03_1k.hdr": "Studio small 1",
    "brown_photostudio_02_1k.hdr": "Brown Photostudio",
    "luminous.hdr": "Luminous",
    "studio_small_08_4k.hdr": "Studio small 2",
    "qwantani_noon_4k.hdr": "Qwantani Noon",
    "venice_sunrise_4k.hdr": "Venice Sunset",
  };

  // the patched app bundle reads this for every environment it loads
  window.__ENV_INTENSITY__ = CONFIG.light;

  // ---- flagged studio for clear finishes ---------------------------------
  // The app's RGBELoader decodes to half floats (Uint16). Float textures
  // render black here (no float-linear filtering on the PMREM path), so the
  // data is edited in place as half floats with the two converters below.
  var held;
  Object.defineProperty(window, "__VIEWER__", {
    configurable: true,
    get: function () { return held; },
    set: function (v) { held = v; }
  });

  function halfToFloat(h) {
    var s = (h & 0x8000) ? -1 : 1, e = (h >> 10) & 0x1f, m = h & 0x3ff;
    if (e === 0) return s * Math.pow(2, -14) * (m / 1024);
    if (e === 31) return m ? NaN : s * Infinity;
    return s * Math.pow(2, e - 15) * (1 + m / 1024);
  }
  var f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
  function floatToHalf(val) {
    f32[0] = val; var x = u32[0];
    var sign = (x >> 16) & 0x8000, exp = ((x >> 23) & 0xff) - 127 + 15, man = x & 0x7fffff;
    if (exp <= 0) { if (exp < -10) return sign; man = (man | 0x800000) >> (1 - exp); return sign | ((man + 0x1000) >> 13); }
    if (exp >= 31) return sign | 0x7c00;
    return sign | (exp << 10) | ((man + 0x1000) >> 13);
  }

  // Given the loaded equirect DataTexture, return a copy with the side bands
  // darkened. Called once per environment load; null = feature off.
  window.__FLAGGED_ENV__ = function (tex) {
    // window.__FLAG_OVERRIDE__ = {flagWidth, flagDark, flagBand} lets you tune
    // live from the console, then call __VIEWER__.loadEnvironment(__VIEWER__.selectedEnvironment)
    var F = Object.assign({}, CONFIG, window.__FLAG_OVERRIDE__ || {});
    if (!F.flagWidth || !tex || !tex.image || !tex.image.data) return null;
    var img = tex.image, w = img.width, h = img.height, src = img.data;
    var isHalf = src instanceof Uint16Array, isFloat = src instanceof Float32Array;
    if (!isHalf && !isFloat) return null;
    var data = isHalf ? new Uint16Array(src) : new Float32Array(src);   // copy, never touch the original
    var ch = data.length / (w * h);                                        // 3 or 4
    var band0 = Math.floor(h * F.flagBand[0]), band1 = Math.ceil(h * F.flagBand[1]);
    var half = F.flagWidth / 2, dark = F.flagDark;
    // equirect: u=0.25 and u=0.75 are the two side walls (u=0.5 faces the camera
    // in three's default orientation, u=0/1 behind the product).
    var centres = [0.25, 0.75];
    for (var y = band0; y < band1; y++) {
      // soft top/bottom edge so the flag does not print a hard line into reflections
      var vy = (y - band0) / (band1 - band0);
      var vEdge = Math.min(1, Math.min(vy, 1 - vy) * 6);
      for (var x = 0; x < w; x++) {
        var u = x / w, wgt = 0;
        for (var i = 0; i < 2; i++) {
          var d = Math.abs(u - centres[i]); d = Math.min(d, 1 - d);
          if (d < half) { var t = 1 - d / half; wgt = Math.max(wgt, Math.min(1, t * 4)); }
        }
        if (!wgt) continue;
        var k = 1 - (1 - dark) * wgt * vEdge;
        var o = (y * w + x) * ch;
        for (var c = 0; c < 3; c++) {
          data[o + c] = isHalf ? floatToHalf(halfToFloat(data[o + c]) * k) : data[o + c] * k;
        }
      }
    }
    // clone() shares the Source object, and `image` is a getter onto it - assigning
    // out.image would overwrite the ORIGINAL studio's pixels too. Give the copy
    // its own Source (same class, constructed from the new image object).
    var out = tex.clone();
    var img2 = { data: data, width: w, height: h };
    out.source = tex.source ? new tex.source.constructor(img2) : img2;
    if (!tex.source) out.image = img2;
    out.needsUpdate = true;
    return out;
  };

  // Which tiles take the flagged copy: any tile whose finish is clear.
  window.__USE_FLAGGED__ = function (viewer) {
    var v = held, defs = v && v.materialDefinitions, name = viewer && viewer.materialName;
    var def = defs && defs[name];
    return !!(def && (def.transmission > CONFIG.flagThreshold || (def.transparent && def.opacity < 0.5)));
  };

  // the patched bundle calls this once per tile with the parsed body material
  // and its JSON definition; return the material to use on closure meshes.
  // Window cutout (2026-10-07): a finish with `alphaMap` is chrome with holes. Put a clear copy of each
  // non-closure mesh just inside it so the holes show base plastic, and hide the label bands (they would
  // otherwise sit over the holes). Called by bundle patch 9 after a finish is applied to a scene.
  window.__POST_APPLY__ = function (scene, def, mat) {
    if (!def || !def.alphaMap) return;
    var base = mat.clone();
    base.alphaMap = null; base.alphaTest = 0; base.map = null; base.normalMap = null;
    base.metalness = 0; base.roughness = 0; base.color.set(0xffffff); base.specularColor && base.specularColor.set(0xffffff);
    base.transparent = true; base.opacity = 0.18; base.depthWrite = false; base.side = 2; base.iridescence = 0; base.needsUpdate = true;
    var adds = [];
    scene.traverse(function (o) {
      if (!o.isMesh) return;
      if (/label/i.test(o.name)) { o.visible = false; return; }
      if (/closure|cap/i.test(o.name)) return;
      // the CAD body UV is not a clean wrap, so give the body a cylindrical UV for the mask:
      // u = angle around Y (0.5 faces the camera), v = height. Position reads work for interleaved data too.
      var g = o.geometry = o.geometry.clone(), pa = g.attributes.position, n = pa.count, ymin = Infinity, ymax = -Infinity;
      for (var i = 0; i < n; i++) { var y = pa.getY(i); if (y < ymin) ymin = y; if (y > ymax) ymax = y; }
      var uv = new Float32Array(n * 2);
      for (var i = 0; i < n; i++) {
        uv[2 * i] = Math.atan2(pa.getX(i), pa.getZ(i)) / (2 * Math.PI) + 0.5;
        uv[2 * i + 1] = 1 - (pa.getY(i) - ymin) / ((ymax - ymin) || 1);   // flipY=false: image row 0 is v=0
      }
      g.setAttribute('uv', new g.index.constructor(uv, 2));
      var inner = o.clone(); inner.material = base; inner.scale.multiplyScalar(0.995); inner.renderOrder = -1;
      adds.push([o, inner]);
    });
    adds.forEach(function (p) { p[0].parent.add(p[1]); });
  };

  window.__CAP_MATERIAL__ = function (body, def) {
    if (!(CONFIG.capRoughness || CONFIG.capShift)) return body;
    var cap = body.clone();
    cap.name = (body.name || "") + " (closure)";
    cap.roughness = Math.min(1, body.roughness + CONFIG.capRoughness);
    if (cap.clearcoat) cap.clearcoatRoughness = Math.min(1, body.clearcoatRoughness + CONFIG.capRoughness * 0.5);
    if (CONFIG.capShift && body.color) {
      var c = body.color;
      var lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
      // fully transmissive finishes carry no body colour to shift - leave them
      if (!(body.transmission > 0.8 || (body.transparent && body.opacity < 0.5))) {
        var k = lum > 0.5 ? 1 - CONFIG.capShift : 1 + CONFIG.capShift * 3;
        cap.color = c.clone().multiplyScalar(k);
        cap.color.r = Math.min(1, cap.color.r); cap.color.g = Math.min(1, cap.color.g); cap.color.b = Math.min(1, cap.color.b);
      }
    }
    cap.needsUpdate = true;
    return cap;
  };

  function prettify(file) {
    return file
      .replace(/\.hdr$/i, "")
      .replace(/[_-]+/g, " ")
      .replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  function buildMap(files) {
    var map = {};
    // curated entries first, in NICE_NAMES order, so the default stays stable
    Object.keys(NICE_NAMES).forEach(function (f) {
      if (files.indexOf(f) !== -1) map[NICE_NAMES[f]] = f;
    });
    files.slice().sort().forEach(function (f) {
      if (!NICE_NAMES[f]) map[prettify(f)] = f;
    });
    return map;
  }

  // immediate fallback so the app never boots without a list
  window.__ENVIRONMENTS__ = buildMap(Object.keys(NICE_NAMES));

  function applyMap(map) {
    window.__ENVIRONMENTS__ = map;
    var v = window.__VIEWER__;
    if (v) {
      v.environments = map;
      v.environmentNames = Object.keys(map);
      if (v.environmentNames.indexOf(v.selectedEnvironment) === -1)
        v.selectedEnvironment = v.environmentNames[0];
    }
    if (window.__ENV_REFRESH__) window.__ENV_REFRESH__();
  }

  // ---- discovery: manifest first (works on any server), folder listing as a
  //      dev fallback, and the NICE_NAMES list if both are unavailable
  function hdrLinksFromListing(html) {
    var doc = new DOMParser().parseFromString(html, "text/html");
    return Array.prototype.slice.call(doc.querySelectorAll("a"))
      .map(function (a) { return decodeURIComponent(a.getAttribute("href") || ""); })
      .filter(function (h) { return /\.hdr$/i.test(h) && h.indexOf("/") === -1; });
  }
  // The FOLDER is the truth wherever the server can list it (local dev):
  // add or delete an .hdr and refresh - nothing else to touch. The manifest
  // only takes over on servers with no listings (GitHub Pages and co.), so
  // keep it fresh with make_env_manifest.py before deploying.
  fetch("assets/environments/")
    .then(function (r) { return r.ok ? r.text() : Promise.reject(r.status); })
    .then(function (html) {
      var files = hdrLinksFromListing(html);
      if (!files.length) throw new Error("no listing");
      applyMap(buildMap(files));
    })
    .catch(function () {
      fetch("assets/environments/environments.json")
        .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
        .then(function (j) {
          if (j && j.files && j.files.length) applyMap(buildMap(j.files));
        })
        .catch(function (e) {
          console.warn("environment discovery unavailable, using built-in list:", e);
        });
    });

  /* -------------------------------------------------------------------------
     Control bar. This build's UI has no environment dropdown of its own, so
     this draws one: an in-flow bar across the top - the canvases sit below
     it, it can never cover the object. With CONFIG.showControls=false the
     bar is hidden but the CONFIG defaults are still applied.
  ------------------------------------------------------------------------- */
  var tries = 0;
  var timer = setInterval(function () {
    var v = window.__VIEWER__;
    if (!v) {                       // app not booted yet
      if (++tries > 300) clearInterval(timer);   // give up after ~60s
      return;
    }
    clearInterval(timer);
    if (document.getElementById("env-picker")) return;

    var box = document.createElement("div");
    box.id = "env-picker";
    box.style.cssText =
      "position:sticky;top:0;z-index:1000;" +   // stays visible while scrolling
      "display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:8px;" +
      "padding:10px;background:#fff;border-bottom:1px solid #ddd;" +
      "box-shadow:0 1px 6px rgba(0,0,0,.08);font:13px system-ui,sans-serif";
    if (!CONFIG.showControls) box.style.display = "none";
    var envOnly = CONFIG.showControls === "env";

    var label = document.createElement("label");
    label.textContent = "Environment";
    label.htmlFor = "env-picker-select";

    // one radio per environment instead of a dropdown
    var radios = document.createElement("div");
    radios.id = "env-picker-select";
    radios.style.cssText = "display:flex;flex-wrap:wrap;gap:4px 14px;align-items:center";

    function refreshOptions() {
      radios.replaceChildren();
      Object.keys(v.environments).forEach(function (name) {
        var lab = document.createElement("label");
        lab.style.cssText = "display:flex;gap:4px;align-items:center;cursor:pointer;white-space:nowrap";
        var r = document.createElement("input");
        r.type = "radio";
        r.name = "env-picker-radio";
        r.value = name;
        r.checked = name === v.selectedEnvironment;
        r.addEventListener("change", function () {
          if (!r.checked) return;
          var all = radios.querySelectorAll("input");
          all.forEach(function (x) { x.disabled = true; });   // one load at a time
          Promise.resolve(v.onEnvironmentChange({ value: name }))
            .catch(function (e) { console.error("environment change failed:", e); })
            .finally(function () { all.forEach(function (x) { x.disabled = false; }); });
        });
        lab.appendChild(r);
        lab.appendChild(document.createTextNode(name));
        radios.appendChild(lab);
      });
    }
    refreshOptions();
    window.__ENV_REFRESH__ = refreshOptions;   // re-run when discovery lands

    function rerender() {           // make changes visible without waiting for a drag
      v.viewers.forEach(function (o) {
        try { o.renderer.render(o.scene, o.camera); } catch (e) {}
      });
    }

    // --- light intensity
    var intLabel = document.createElement("label");
    intLabel.textContent = "Light";
    intLabel.style.marginLeft = "12px";
    var slider = document.createElement("input");
    slider.type = "range";
    slider.min = "0.25"; slider.max = "3"; slider.step = "0.05";
    slider.value = String(CONFIG.light);
    slider.style.cssText = "width:110px;vertical-align:middle";
    var intVal = document.createElement("span");
    intVal.textContent = CONFIG.light.toFixed(2).replace(/0$/, "");
    intVal.style.cssText = "min-width:26px;color:#666";
    slider.addEventListener("input", function () {
      var x = parseFloat(slider.value);
      window.__ENV_INTENSITY__ = x;              // survives environment switches
      intVal.textContent = x.toFixed(2).replace(/0$/, "");
      v.viewers.forEach(function (o) { o.scene.environmentIntensity = x; });
      rerender();
    });

    // --- Khronos PBR Neutral tone mapping: keeps base colours true while
    // taming highlights. three: NoToneMapping=0, NeutralToneMapping=7
    var toneLabel = document.createElement("label");
    toneLabel.style.cssText = "margin-left:12px;display:flex;gap:4px;align-items:center;cursor:pointer";
    var tone = document.createElement("input");
    tone.type = "checkbox";
    tone.checked = CONFIG.trueColor;
    toneLabel.appendChild(tone);
    toneLabel.appendChild(document.createTextNode("True color"));
    function applyTone() {
      v.viewers.forEach(function (o) {
        o.renderer.toneMapping = tone.checked ? 7 : 0;
        o.scene.traverse(function (obj) {
          var m = obj.material;
          if (!m) return;
          (Array.isArray(m) ? m : [m]).forEach(function (mm) { mm.needsUpdate = true; });
        });
      });
      rerender();
    }
    tone.addEventListener("change", applyTone);
    // the viewers are created only after the model loads, so wait for them
    // before applying the CONFIG defaults
    var tw = setInterval(function () {
      if (!v.viewers.length) return;
      clearInterval(tw);
      // default zoom: frame the product to CONFIG.fit of the tile height
      // instead of the app's fixed camera distance
      if (CONFIG.fit) {
        v.viewers.forEach(function (o) {
          try {
            var minY = 1/0, maxY = -1/0, V3 = o.camera.position.constructor;
            o.scene.traverse(function (n) {
              if (!n.isMesh || !n.geometry) return;
              n.geometry.computeBoundingBox();
              var b = n.geometry.boundingBox;
              [b.min.y, b.max.y].forEach(function (y) {
                [[b.min.x, b.min.z], [b.max.x, b.max.z]].forEach(function (xz) {
                  var w = n.localToWorld(new V3(xz[0], y, xz[1]));
                  if (w.y < minY) minY = w.y;
                  if (w.y > maxY) maxY = w.y;
                });
              });
            });
            var h = maxY - minY;
            if (!isFinite(h) || h <= 0) return;
            var d = (h / 2) / Math.tan(o.camera.fov * Math.PI / 360) / CONFIG.fit;
            // aim at the product's actual middle so it does not sit low in
            // the tile, and orbit around that point too
            var cy = (minY + maxY) / 2;
            o.controls.target.set(0, cy, 0);
            o.camera.position.set(0, cy + h * 0.03, d);
            o.camera.lookAt(0, cy, 0);
          } catch (e) { console.warn("fit skipped:", e); }
        });
      }
      applyTone();
      // one-line helper under each tile title, from the material's own
      // "description" field in materials.json (the client's wording)
      document.querySelectorAll(".viewer-wrapper").forEach(function (wrp) {
        var h = wrp.querySelector("h3");
        if (!h || wrp.querySelector(".mat-desc")) return;
        var def = v.materialDefinitions && v.materialDefinitions[h.textContent.trim()];
        if (!def || !def.description) return;
        var dd = document.createElement("div");
        dd.className = "mat-desc";
        dd.textContent = def.description;
        // fixed two-line slot so every card is the same height and the
        // grid rows stay aligned no matter how long each description is
        dd.style.cssText = "font:12px/1.45 system-ui,sans-serif;color:#777;" +
          "text-align:center;max-width:280px;margin:-2px auto 8px;padding:0 12px;" +
          "height:35px;overflow:hidden;display:-webkit-box;" +
          "-webkit-line-clamp:2;-webkit-box-orient:vertical";
        h.insertAdjacentElement("afterend", dd);
      });
      v.viewers.forEach(function (o) {
        o.scene.environmentIntensity = window.__ENV_INTENSITY__;
        if (CONFIG.backdrop) {
          // the gradient must live INSIDE the scene, not as CSS behind a
          // transparent canvas: clear/translucent finishes (transmission)
          // refract whatever the renderer sees behind the product, and a
          // transparent clear makes them refract a black void. A background
          // texture gives them the real grey studio to look through.
          try {
            var bcv = document.createElement("canvas");
            bcv.width = bcv.height = 512;
            var bctx = bcv.getContext("2d");
            var bg = bctx.createRadialGradient(256, 180, 40, 256, 256, 360);
            bg.addColorStop(0, "#ffffff");
            bg.addColorStop(0.5, "#ededed");
            bg.addColorStop(1, "#cccccc");
            bctx.fillStyle = bg;
            bctx.fillRect(0, 0, 512, 512);
            var btex = new (o.scene.environment.constructor)(bcv);
            btex.colorSpace = "srgb";
            btex.needsUpdate = true;
            o.scene.background = btex;
          } catch (e) {                    // fall back to the CSS route
            o.renderer.setClearColor(0, 0);
            if (o.canvas && o.canvas.parentElement)
              o.canvas.parentElement.style.background = CONFIG.backdrop;
          }
        }
      });
      rerender();
    }, 300);

    // --- contact shadow: a radial-gradient plane sat just under the model, so
    // every product looks grounded instead of floating. Built entirely from
    // classes borrowed off the live scene (no direct three.js import exists
    // here), and skipped harmlessly if any of that ever changes.
    function addGroundShadow(o) {
      var mesh = null;
      o.scene.traverse(function (n) { if (!mesh && n.isMesh && n.geometry) mesh = n; });
      if (!mesh || !o.scene.environment) return false;
      var V3 = o.camera.position.constructor;
      var Geo = mesh.geometry.constructor;
      // a quantized GLB (KHR_mesh_quantization) interleaves its vertex data, so
      // position is an InterleavedBufferAttribute; the index is always a plain
      // BufferAttribute, which is the class the shadow plane needs.
      var pa = mesh.geometry.attributes.position;
      var Attr = (pa.isInterleavedBufferAttribute && mesh.geometry.index) ? mesh.geometry.index.constructor : pa.constructor;
      var Tex = o.scene.environment.constructor;
      var Mat = mesh.material.constructor;
      var MeshC = mesh.constructor;

      // world-space bounds of the whole model
      var minX = 1/0, maxX = -1/0, minY = 1/0, minZ = 1/0, maxZ = -1/0;
      o.scene.traverse(function (n) {
        if (!n.isMesh || !n.geometry) return;
        n.geometry.computeBoundingBox();
        var b = n.geometry.boundingBox;
        [b.min.x, b.max.x].forEach(function (x) {
          [b.min.y, b.max.y].forEach(function (y) {
            [b.min.z, b.max.z].forEach(function (z) {
              var w = n.localToWorld(new V3(x, y, z));
              if (w.x < minX) minX = w.x; if (w.x > maxX) maxX = w.x;
              if (w.y < minY) minY = w.y;
              if (w.z < minZ) minZ = w.z; if (w.z > maxZ) maxZ = w.z;
            });
          });
        });
      });
      var ext = Math.max(maxX - minX, maxZ - minZ);
      if (!isFinite(ext) || ext <= 0) return false;

      // product-photo style: a dense contact core right at the base plus a
      // softer shadow spreading to one side, as if the key light sits
      // front-left. Drawn in plan view; the 3D plane gives it perspective.
      var cv = document.createElement("canvas");
      cv.width = cv.height = 512;
      var ctx = cv.getContext("2d");
      var A = CONFIG.groundShadow;
      function blob(cx, cy, rx, ry, a) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(rx / 100, ry / 100);
        var g = ctx.createRadialGradient(0, 0, 0, 0, 0, 100);
        g.addColorStop(0, "rgba(0,0,0," + a + ")");
        g.addColorStop(0.55, "rgba(0,0,0," + a * 0.45 + ")");
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(0, 0, 100, 0, 6.2832);
        ctx.fill();
        ctx.restore();
      }
      blob(256, 256, 92, 80, A * 1.2);    // contact core under the base
      blob(322, 264, 195, 118, A * 0.5);  // soft spread away from the key light
      var tex = new Tex(cv);
      tex.needsUpdate = true;

      var s = ext * 1.05;   // wide enough for the sideways spread
      var geo = new Geo();
      geo.setAttribute("position", new Attr(new Float32Array([-s,0,-s, s,0,-s, -s,0,s, s,0,s]), 3));
      geo.setAttribute("uv", new Attr(new Float32Array([0,1, 1,1, 0,0, 1,0]), 2));
      geo.setIndex([0, 2, 1, 1, 2, 3]);

      var mat = new Mat({ map: tex, transparent: true, depthWrite: false });
      mat.toneMapped = false;
      mat.side = 2;
      if ("envMapIntensity" in mat) mat.envMapIntensity = 0;
      if ("roughness" in mat) mat.roughness = 1;
      if ("metalness" in mat) mat.metalness = 0;
      if ("specularIntensity" in mat) mat.specularIntensity = 0;

      var plane = new MeshC(geo, mat);
      plane.position.set((minX + maxX) / 2, minY - ext * 0.01, (minZ + maxZ) / 2);
      plane.renderOrder = -1;
      o.scene.add(plane);
      if (CONFIG.floorLock && o.controls) o.controls.maxPolarAngle = Math.PI / 2 - 0.03;
      return true;
    }
    if (CONFIG.groundShadow > 0) {
      var stries = 0;
      var stimer = setInterval(function () {
        var pending = false;
        v.viewers.forEach(function (o) {
          if (o.__shadowAdded) return;
          try { o.__shadowAdded = addGroundShadow(o); }
          catch (e) { o.__shadowAdded = true; console.warn("ground shadow skipped:", e); }
          if (!o.__shadowAdded) pending = true;
        });
        if (!pending || ++stries > 60) { clearInterval(stimer); rerender(); }
      }, 500);
    }

    box.appendChild(label);
    box.appendChild(radios);
    if (!envOnly) {                  // tuning stays internal in "env" mode
      box.appendChild(intLabel);
      box.appendChild(slider);
      box.appendChild(intVal);
      box.appendChild(toneLabel);
    }
    document.body.insertBefore(box, document.body.firstChild);
  }, 200);
})();
