// Renders pages with Apple's WebKit (the engine inside Safari) with no window on screen, saves a full-page picture of each one,
// and writes a small report of what WebKit saw: sideways overflow, script errors, loaded fonts and which newer CSS features it supports.
//
//   webkitshot --base http://127.0.0.1:4400 --pages /,/start --width 1280 --tag desktop --out DIR [--freeze] [--mobile]
import Cocoa
import WebKit

struct Options {
    var base = "http://127.0.0.1:4400"
    var pages = ["/"]
    var width: CGFloat = 1280
    var tag = "desktop"
    var out = "."
    var freeze = false
    var mobile = false
    var geom = ""
    var pictures = true
    var openDetails = false
}

func parse() -> Options {
    var o = Options()
    var it = CommandLine.arguments.dropFirst().makeIterator()
    while let a = it.next() {
        switch a {
        case "--base": o.base = it.next() ?? o.base
        case "--pages": o.pages = (it.next() ?? "/").split(separator: ",").map(String.init)
        case "--width": o.width = CGFloat(Double(it.next() ?? "1280") ?? 1280)
        case "--tag": o.tag = it.next() ?? o.tag
        case "--out": o.out = it.next() ?? o.out
        case "--freeze": o.freeze = true
        case "--mobile": o.mobile = true
        case "--nopic": o.pictures = false
        case "--open": o.openDetails = true
        case "--geom": o.geom = (try? String(contentsOfFile: it.next() ?? "", encoding: .utf8)) ?? ""
        default: break
        }
    }
    return o
}

let freezeCSS = "*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;animation-iteration-count:1!important;animation-fill-mode:forwards!important;transition:none!important;scroll-behavior:auto!important}"

// What to measure inside the page once it has loaded.
let probe = """
await document.fonts.ready;
const W = innerWidth;
const over = [];
for (const el of document.querySelectorAll('body *')) {
  const cs = getComputedStyle(el);
  if (cs.position === 'fixed' || cs.display === 'none') continue;
  const r = el.getBoundingClientRect();
  if (r.width > 0 && r.right > W + 2) {
    let clipped = false;
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) { if (getComputedStyle(a).overflowX !== 'visible') { clipped = true; break; } }
    if (!clipped) over.push(el.tagName.toLowerCase() + '.' + String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className).split(' ')[0] + ' right=' + Math.round(r.right));
  }
}
const feats = {};
for (const [k, v] of Object.entries({
  'backdrop-filter': 'backdrop-filter: blur(2px)', ':has()': 'selector(:has(a))', 'text-wrap: balance': 'text-wrap: balance', 'aspect-ratio': 'aspect-ratio: 1 / 1',
  'dvh units': 'height: 100dvh', 'gap in flex': 'gap: 1rem', 'inset': 'inset: 0', 'clamp()': 'width: clamp(1rem, 2vw, 3rem)', 'color-mix()': 'color: color-mix(in srgb, red, blue)',
  'container queries': 'container-type: inline-size', 'scroll-margin': 'scroll-margin-top: 1rem', 'overflow: clip': 'overflow: clip', 'accent-color': 'accent-color: red',
})) {
  feats[k] = v.startsWith('selector(') ? CSS.supports(v) : CSS.supports(v);
}
return JSON.stringify({
  title: document.title,
  scrollHeight: Math.ceil(document.documentElement.scrollHeight),
  scrollWidth: document.documentElement.scrollWidth,
  innerWidth: W,
  sidewaysOverflow: document.documentElement.scrollWidth > W + 1,
  overflowing: over.slice(0, 6),
  fonts: [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replace(/"/g, '') + ' ' + f.weight + ' ' + f.style),
  bodyFont: getComputedStyle(document.body).fontFamily,
  bodyFontSize: getComputedStyle(document.body).fontSize,
  devicePixelRatio,
  features: feats,
  userAgent: navigator.userAgent,
  headings: document.querySelectorAll('h1,h2,h3').length,
  images: [...document.images].map((i) => ({ src: i.currentSrc.replace(location.origin, ''), ok: i.complete && i.naturalWidth > 0 })).filter((i) => !i.ok),
  inputs: [...document.querySelectorAll('input,select,textarea')].map((e) => ({ tag: e.tagName.toLowerCase(), size: getComputedStyle(e).fontSize })),
});
"""

@MainActor
final class Runner: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
    let opts: Options
    let web: WKWebView
    let win: NSWindow
    var loaded: CheckedContinuation<Void, Never>?
    var messages: [String] = []

    init(_ o: Options) {
        opts = o
        let conf = WKWebViewConfiguration()
        let ucc = WKUserContentController()
        let hook = """
        window.addEventListener('error', e => window.webkit.messageHandlers.log.postMessage('error: ' + e.message + ' @' + String(e.filename).split('/').pop() + ':' + e.lineno));
        window.addEventListener('unhandledrejection', e => window.webkit.messageHandlers.log.postMessage('unhandled rejection: ' + e.reason));
        const ce = console.error; console.error = function () { window.webkit.messageHandlers.log.postMessage('console.error: ' + Array.from(arguments).join(' ')); ce.apply(console, arguments); };
        """
        ucc.addUserScript(WKUserScript(source: hook, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        if o.freeze {
            let css = "var s=document.createElement('style');s.textContent='\(freezeCSS)';document.documentElement.appendChild(s);"
            ucc.addUserScript(WKUserScript(source: css, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        }
        conf.userContentController = ucc
        let frame = NSRect(x: 0, y: 0, width: o.width, height: 900)
        web = WKWebView(frame: frame, configuration: conf)
        if o.mobile {
            web.customUserAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
        }
        win = NSWindow(contentRect: frame, styleMask: [.borderless], backing: .buffered, defer: false)
        win.contentView = web
        win.isReleasedWhenClosed = false
        super.init()
        ucc.add(self, name: "log")
        web.navigationDelegate = self
    }

    func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) { messages.append(String(describing: m.body)) }
    func webView(_ w: WKWebView, didFinish n: WKNavigation!) { loaded?.resume(); loaded = nil }
    func webView(_ w: WKWebView, didFail n: WKNavigation!, withError e: Error) { messages.append("navigation failed: \(e.localizedDescription)"); loaded?.resume(); loaded = nil }
    func webView(_ w: WKWebView, didFailProvisionalNavigation n: WKNavigation!, withError e: Error) { messages.append("navigation failed: \(e.localizedDescription)"); loaded?.resume(); loaded = nil }

    func sleep(_ s: Double) async { try? await Task.sleep(nanoseconds: UInt64(s * 1_000_000_000)) }

    func run() async {
        // The window has to exist for WebKit to paint, but it is fully see-through and sits behind everything.
        win.alphaValue = 0.01
        win.ignoresMouseEvents = true
        win.level = NSWindow.Level(rawValue: -2000)
        win.orderBack(nil)
        var report: [[String: Any]] = []
        for p in opts.pages {
            messages = []
            win.setContentSize(NSSize(width: opts.width, height: 900))
            web.frame = NSRect(x: 0, y: 0, width: opts.width, height: 900)
            await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in
                loaded = c
                web.load(URLRequest(url: URL(string: opts.base + p)!))
            }
            await sleep(1.4)
            if opts.openDetails { _ = try? await web.callAsyncJavaScript("document.querySelectorAll('details').forEach(d => d.open = true); return 1;", arguments: [:], in: nil, contentWorld: .page); await sleep(0.4) }
            var info: [String: Any] = ["page": p]
            do {
                let raw = try await web.callAsyncJavaScript(probe, arguments: [:], in: nil, contentWorld: .page)
                if let s = raw as? String, let d = s.data(using: .utf8), let j = try JSONSerialization.jsonObject(with: d) as? [String: Any] { info.merge(j) { $1 } }
                // Where every box is, measured before the window is stretched to the page height so both engines are measured the same way.
                if !opts.geom.isEmpty {
                    let g = try await web.callAsyncJavaScript("await document.fonts.ready; return JSON.stringify(" + opts.geom + ");", arguments: [:], in: nil, contentWorld: .page)
                    if let s = g as? String, let d = s.data(using: .utf8), let arr = try JSONSerialization.jsonObject(with: d) as? [Any] { info["geom"] = arr }
                }
                let h = (info["scrollHeight"] as? Int) ?? 900
                if !opts.pictures { info["messages"] = messages; report.append(info); continue }
                let height = CGFloat(min(h, 15000))
                win.setContentSize(NSSize(width: opts.width, height: height))
                web.frame = NSRect(x: 0, y: 0, width: opts.width, height: height)
                await sleep(0.9)
                let cfg = WKSnapshotConfiguration()
                cfg.rect = NSRect(x: 0, y: 0, width: opts.width, height: height)
                cfg.snapshotWidth = NSNumber(value: Double(opts.width))
                let image = try await web.takeSnapshot(configuration: cfg)
                if let tiff = image.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff), let png = rep.representation(using: .png, properties: [:]) {
                    let slug = p == "/" ? "home" : p.filter { $0.isLetter || $0.isNumber }
                    let path = "\(opts.out)/\(slug)-\(opts.tag)-webkit.png"
                    try png.write(to: URL(fileURLWithPath: path))
                    info["picture"] = path
                    info["pixels"] = "\(rep.pixelsWide)x\(rep.pixelsHigh)"
                }
            } catch {
                info["error"] = "\(error)"
            }
            info["messages"] = messages
            report.append(info)
            FileHandle.standardError.write(Data("done \(p)\n".utf8))
        }
        if let data = try? JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys]) {
            try? data.write(to: URL(fileURLWithPath: "\(opts.out)/webkit-\(opts.tag)-report.json"))
        }
        exit(0)
    }
}

MainActor.assumeIsolated {
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    let runner = Runner(parse())
    Task { @MainActor in await runner.run() }
    // A page that never loads must not leave this running for ever.
    DispatchQueue.main.asyncAfter(deadline: .now() + 240) { FileHandle.standardError.write(Data("timed out\n".utf8)); exit(2) }
    app.run()
}
