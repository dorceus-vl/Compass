// Makes the menu-bar template image from the badge: swiftc -o /tmp/tray mac/tray-icon.swift && /tmp/tray assets/brand/compass-logo.png mac/src-tauri/icons/tray-template.png
import AppKit
// The menu-bar template: the badge at 44x44 (22 pt @2x), black with its brightness as alpha (the ring, lettering, eyes and compass rose).
let src = NSImage(contentsOfFile: CommandLine.arguments[1])!
let n = 44
let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: n, pixelsHigh: n, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
NSGraphicsContext.current!.imageInterpolation = .high
src.draw(in: NSRect(x: 0, y: 0, width: n, height: n))
NSGraphicsContext.restoreGraphicsState()
let out = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: n, pixelsHigh: n, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
for y in 0..<n { for x in 0..<n {
  let c = rep.colorAt(x: x, y: y)!.usingColorSpace(.deviceRGB)!
  let l = 0.2126 * c.redComponent + 0.7152 * c.greenComponent + 0.0722 * c.blueComponent
  let r = hypot(Double(x) - 21.5, Double(y) - 21.5)
  let a = r > 22 ? 0 : min(1, max(0, (l - 0.12) / 0.2)) // the badge only (its corner mark drops out) // the dark owl drops out; the light ring and eyes stay
  out.setColor(NSColor(deviceRed: 0, green: 0, blue: 0, alpha: a), atX: x, y: y)
}}
try! out.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: CommandLine.arguments[2]))
