import AppKit
import Foundation

func color(_ hex: String) -> NSColor {
    var s = hex.trimmingCharacters(in: .whitespaces)
    if s.hasPrefix("#") { s.removeFirst() }
    if s.count == 3 { s = s.map { "\($0)\($0)" }.joined() }
    let v = UInt32(s, radix: 16) ?? 0xFFFFFF
    return NSColor(calibratedRed: CGFloat((v >> 16) & 0xFF) / 255,
                   green: CGFloat((v >> 8) & 0xFF) / 255,
                   blue: CGFloat(v & 0xFF) / 255,
                   alpha: 1)
}

let args = CommandLine.arguments
guard args.count >= 7 else { print("usage: draw <src> <out> <text> <size> <color> <top|center|bottom>"); exit(2) }
let src = args[1], out = args[2], text = args[3]
var size = CGFloat(Double(args[4]) ?? 36)
let fg = color(args[5])
let place = args[6]

guard let img = NSImage(contentsOfFile: src),
      let tiff = img.tiffRepresentation,
      let rep = NSBitmapImageRep(data: tiff) else { print("bad image"); exit(3) }
let w = CGFloat(rep.pixelsWide), h = CGFloat(rep.pixelsHigh)
guard let ctx = NSGraphicsContext(bitmapImageRep: rep) else { print("no context"); exit(4) }

NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = ctx
ctx.imageInterpolation = .high

func measure(_ s: CGFloat) -> (NSAttributedString, NSSize) {
    let f = NSFont.systemFont(ofSize: s, weight: .semibold)
    let a = NSAttributedString(string: text, attributes: [.font: f, .foregroundColor: fg])
    let b = a.boundingRect(with: NSSize(width: CGFloat.greatestFiniteMagnitude, height: .greatestFiniteMagnitude),
                           options: [.usesLineFragmentOrigin])
    return (a, b.size)
}

// 太长就往下缩，最小 12pt——宁可字小，也不要溢出画面。
var (str, bounds) = measure(size)
while bounds.width > w - size * 0.9 && size > 12 {
    size -= 2
    (str, bounds) = measure(size)
}

let pad = max(8, size * 0.45)
let barH = min(h, bounds.height + pad * 2)
let barY: CGFloat
switch place {
case "top": barY = h - barH
case "center": barY = (h - barH) / 2
default: barY = 0
}

NSColor(calibratedWhite: 0, alpha: 0.55).setFill()
NSBezierPath(rect: NSRect(x: 0, y: barY, width: w, height: barH)).fill()
str.draw(at: NSPoint(x: pad, y: barY + pad))
NSGraphicsContext.restoreGraphicsState()

guard let png = rep.representation(using: .png, properties: [:]) else { print("encode failed"); exit(5) }
do {
    try png.write(to: URL(fileURLWithPath: out))
} catch {
    print("write failed: \(error)")
    exit(6)
}
print("ok \(Int(w))x\(Int(h))")
