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
    light: 1.5,        // environment intensity on open (app's old fixed value: 2)
    trueColor: true,   // Khronos PBR Neutral tone mapping on open
    showControls: false // preview build: locked look, no controls
  };

  var NICE_NAMES = {
    "neutral_studio.hdr": "Neutral Studio (true color)",
    "studio_small_03_1k.hdr": "Studio small 1",
    "brown_photostudio_02_1k.hdr": "Brown Photostudio",
    "luminous.hdr": "Luminous",
    "studio.hdr": "Studio",
    "studio_small_08_4k.hdr": "Studio small 2",
    "qwantani_noon_4k.hdr": "Qwantani Noon",
    "venice_sunrise_4k.hdr": "Venice Sunset",
  };

  // the patched app bundle reads this for every environment it loads
  window.__ENV_INTENSITY__ = CONFIG.light;

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
  fetch("assets/environments/environments.json")
    .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
    .then(function (j) {
      if (j && j.files && j.files.length) applyMap(buildMap(j.files));
    })
    .catch(function () {
      fetch("assets/environments/")
        .then(function (r) { return r.ok ? r.text() : Promise.reject(r.status); })
        .then(function (html) {
          var files = hdrLinksFromListing(html);
          if (files.length) applyMap(buildMap(files));
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
      "display:flex;justify-content:center;align-items:center;gap:8px;" +
      "padding:10px;background:#fff;border-bottom:1px solid #ddd;" +
      "font:13px system-ui,sans-serif";
    if (!CONFIG.showControls) box.style.display = "none";

    var label = document.createElement("label");
    label.textContent = "Environment";
    label.htmlFor = "env-picker-select";

    var sel = document.createElement("select");
    sel.id = "env-picker-select";
    sel.style.cssText = "font:inherit;padding:3px 6px;max-width:260px";

    function refreshOptions() {
      sel.replaceChildren();
      Object.keys(v.environments).forEach(function (name) {
        var o = document.createElement("option");
        o.value = name;
        o.textContent = name;
        sel.appendChild(o);
      });
      sel.value = v.selectedEnvironment;
    }
    refreshOptions();
    window.__ENV_REFRESH__ = refreshOptions;   // re-run when discovery lands

    sel.addEventListener("change", function () {
      sel.disabled = true;          // one load at a time
      Promise.resolve(v.onEnvironmentChange({ value: sel.value }))
        .catch(function (e) { console.error("environment change failed:", e); })
        .finally(function () { sel.disabled = false; });
    });

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
      applyTone();
      v.viewers.forEach(function (o) { o.scene.environmentIntensity = window.__ENV_INTENSITY__; });
      rerender();
    }, 300);

    box.appendChild(label);
    box.appendChild(sel);
    box.appendChild(intLabel);
    box.appendChild(slider);
    box.appendChild(intVal);
    box.appendChild(toneLabel);
    document.body.insertBefore(box, document.body.firstChild);
  }, 200);
})();
