// Draws the app icon set and the DMG background from the paper-cube artwork the
// iOS app uses. Run by build-app.sh and make-dmg.sh:
//
//   swift scripts/make-art.swift <cube.png> <out-dir>
//
// Writes <out-dir>/AppIcon.iconset/ (for iconutil) and
// <out-dir>/dmg-background.png and dmg-background@2x.png.
import AppKit

let args = CommandLine.arguments
guard args.count == 3, let cube = NSImage(contentsOfFile: args[1]) else {
    FileHandle.standardError.write(Data("usage: make-art.swift <cube.png> <out-dir>\n".utf8))
    exit(2)
}
let out = URL(fileURLWithPath: args[2], isDirectory: true)

// Warm paper colors, matching the web app's warm palette.
let cream = NSColor(srgbRed: 0.988, green: 0.961, blue: 0.910, alpha: 1)
let parchment = NSColor(srgbRed: 0.945, green: 0.894, blue: 0.800, alpha: 1)
let honey = NSColor(srgbRed: 0.808, green: 0.553, blue: 0.180, alpha: 1)
let ink = NSColor(srgbRed: 0.278, green: 0.200, blue: 0.129, alpha: 1)

func render(width: Int, height: Int, _ draw: (CGRect) -> Void) -> Data {
    let rep = NSBitmapImageRep(
        bitmapDataPlanes: nil, pixelsWide: width, pixelsHigh: height, bitsPerSample: 8,
        samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
        bytesPerRow: 0, bitsPerPixel: 0
    )!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    draw(CGRect(x: 0, y: 0, width: width, height: height))
    NSGraphicsContext.restoreGraphicsState()
    return rep.representation(using: .png, properties: [:])!
}

/// The macOS icon grid: an 824-point rounded square centered on a 1024 canvas.
func drawIcon(in canvas: CGRect) {
    let scale = canvas.width / 1024
    let plate = canvas.insetBy(dx: 100 * scale, dy: 100 * scale)
    let shape = NSBezierPath(roundedRect: plate, xRadius: 185 * scale, yRadius: 185 * scale)

    NSGraphicsContext.saveGraphicsState()
    let lift = NSShadow()
    lift.shadowColor = NSColor.black.withAlphaComponent(0.25)
    lift.shadowOffset = NSSize(width: 0, height: -10 * scale)
    lift.shadowBlurRadius = 20 * scale
    lift.set()
    cream.setFill()
    shape.fill()
    NSGraphicsContext.restoreGraphicsState()

    NSGradient(starting: cream, ending: parchment)!.draw(in: shape, angle: -90)
    honey.withAlphaComponent(0.35).setStroke()
    shape.lineWidth = 4 * scale
    shape.stroke()

    let side = 560 * scale
    let cubeRect = CGRect(x: canvas.midX - side / 2, y: canvas.midY - side / 2 + 10 * scale, width: side, height: side)
    NSGraphicsContext.saveGraphicsState()
    let drop = NSShadow()
    drop.shadowColor = ink.withAlphaComponent(0.35)
    drop.shadowOffset = NSSize(width: 0, height: -18 * scale)
    drop.shadowBlurRadius = 28 * scale
    drop.set()
    cube.draw(in: cubeRect, from: .zero, operation: .sourceOver, fraction: 1)
    NSGraphicsContext.restoreGraphicsState()
}

func hexagon(center: CGPoint, radius: CGFloat) -> NSBezierPath {
    let path = NSBezierPath()
    for i in 0..<6 {
        let angle = CGFloat(i) * .pi / 3
        let point = CGPoint(x: center.x + radius * cos(angle), y: center.y + radius * sin(angle))
        if i == 0 { path.move(to: point) } else { path.line(to: point) }
    }
    path.close()
    return path
}

/// 660 x 420 points: title at the top, the app on the left (170, 230 from the
/// top-left, Finder's coordinates), Applications on the right (490, 230), and
/// an arrow between them.
func drawBackground(in canvas: CGRect) {
    let s = canvas.width / 660
    NSGradient(starting: cream, ending: parchment)!.draw(in: canvas, angle: -90)

    // A faint honeycomb along the bottom edge.
    honey.withAlphaComponent(0.10).setStroke()
    let r = 22 * s
    let dx = r * 1.5, dy = r * sqrt(3)
    var col = 0
    var x = -r
    while x < canvas.width + r {
        var y = (col % 2 == 0 ? 0 : dy / 2) - r
        while y < 120 * s {
            let hex = hexagon(center: CGPoint(x: x, y: y), radius: r - 2 * s)
            hex.lineWidth = 2 * s
            hex.stroke()
            y += dy
        }
        x += dx
        col += 1
    }

    func text(_ string: String, size: CGFloat, weight: NSFont.Weight, color: NSColor, top: CGFloat) {
        let style = NSMutableParagraphStyle()
        style.alignment = .center
        let attributed = NSAttributedString(string: string, attributes: [
            .font: NSFont.systemFont(ofSize: size * s, weight: weight),
            .foregroundColor: color,
            .paragraphStyle: style,
        ])
        let height = attributed.size().height
        attributed.draw(in: CGRect(x: 0, y: canvas.height - top * s - height, width: canvas.width, height: height))
    }
    text("Bee Box Desktop", size: 26, weight: .semibold, color: ink, top: 38)
    text("Drag it into Applications to install.", size: 14, weight: .regular, color: ink.withAlphaComponent(0.7), top: 76)

    // Arrow from the app toward Applications, a gentle dashed arc.
    let y = canvas.height - 230 * s
    let start = CGPoint(x: 262 * s, y: y + 8 * s)
    let end = CGPoint(x: 398 * s, y: y + 8 * s)
    let arc = NSBezierPath()
    arc.move(to: start)
    arc.curve(to: end, controlPoint1: CGPoint(x: 300 * s, y: y + 44 * s), controlPoint2: CGPoint(x: 360 * s, y: y + 44 * s))
    arc.lineWidth = 5 * s
    arc.lineCapStyle = .round
    arc.setLineDash([12 * s, 10 * s], count: 2, phase: 0)
    honey.setStroke()
    arc.stroke()
    let head = NSBezierPath()
    head.move(to: CGPoint(x: end.x - 18 * s, y: end.y + 14 * s))
    head.line(to: end)
    head.line(to: CGPoint(x: end.x - 20 * s, y: end.y - 8 * s))
    head.lineWidth = 5 * s
    head.lineCapStyle = .round
    head.lineJoinStyle = .round
    head.stroke()
}

let iconset = out.appendingPathComponent("AppIcon.iconset", isDirectory: true)
try FileManager.default.createDirectory(at: iconset, withIntermediateDirectories: true)
for points in [16, 32, 128, 256, 512] {
    for scale in [1, 2] {
        let pixels = points * scale
        let name = scale == 1 ? "icon_\(points)x\(points).png" : "icon_\(points)x\(points)@2x.png"
        try render(width: pixels, height: pixels, drawIcon).write(to: iconset.appendingPathComponent(name))
    }
}
try render(width: 660, height: 420, drawBackground).write(to: out.appendingPathComponent("dmg-background.png"))
try render(width: 1320, height: 840, drawBackground).write(to: out.appendingPathComponent("dmg-background@2x.png"))
